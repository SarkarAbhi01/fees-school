import fs from 'fs';
import jwt from 'jsonwebtoken';

/**
 * Google Drive upload with plain fetch (no extra package).
 * Option A (personal Google Drive, recommended): GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
 * Option B (a Shared Drive): GOOGLE_SERVICE_ACCOUNT_FILE (path to the key .json) or GOOGLE_SERVICE_ACCOUNT_JSON
 * Both need GOOGLE_DRIVE_FOLDER_ID = the folder the backups go into.
 */
const env = (k: string) => (process.env[k] ?? '').trim();

export function driveMode(): 'oauth' | 'service' | null {
  if (!env('GOOGLE_DRIVE_FOLDER_ID')) return null;
  if (env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') && env('GOOGLE_REFRESH_TOKEN')) return 'oauth';
  if (env('GOOGLE_SERVICE_ACCOUNT_FILE') || env('GOOGLE_SERVICE_ACCOUNT_JSON')) return 'service';
  return null;
}

let cached: { token: string; exp: number } | null = null;
async function accessToken() {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const mode = driveMode();
  let body: URLSearchParams;
  if (mode === 'oauth') {
    body = new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: env('GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token' });
  } else if (mode === 'service') {
    const key = JSON.parse(env('GOOGLE_SERVICE_ACCOUNT_JSON') || fs.readFileSync(env('GOOGLE_SERVICE_ACCOUNT_FILE'), 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 }, key.private_key, { algorithm: 'RS256' });
    body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  } else throw new Error('Google Drive is not set up (see README: Google Drive backup)');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in failed: ${j.error_description ?? j.error ?? r.status}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function g(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.headers ?? {}) } });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Google Drive ${r.status}: ${t.slice(0, 200)}`); }
  return r;
}

/** Sub folder (one per school) inside the configured folder, created on first use. */
async function subFolder(name: string) {
  const parent = env('GOOGLE_DRIVE_FOLDER_ID');
  const safe = name.replace(/['\\]/g, '');
  const q = encodeURIComponent(`name = '${safe}' and '${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const found: any = await (await g(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json();
  if (found.files?.[0]?.id) return found.files[0].id as string;
  const made: any = await (await g('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: safe, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
  })).json();
  return made.id as string;
}

/** Uploads one file; returns the Drive file id. */
export async function uploadToDrive(filePath: string, name: string, mime: string, folderName: string) {
  const size = (await fs.promises.stat(filePath)).size;
  if (size > 400 * 1024 * 1024) throw new Error('File is larger than 400 MB, too big for automatic upload');
  const folder = await subFolder(folderName);
  const start = await g('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify({ name, parents: [folder] }),
  });
  const loc = start.headers.get('location');
  if (!loc) throw new Error('Google Drive did not return an upload address');
  const up = await g(loc, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(size) }, body: await fs.promises.readFile(filePath) });
  const j: any = await up.json().catch(() => ({}));
  return String(j.id ?? '');
}
