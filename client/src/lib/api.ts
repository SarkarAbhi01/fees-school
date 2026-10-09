export const API = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface Opts { method?: string; body?: unknown; form?: FormData }

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !path.includes('/auth/login')) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Something went wrong');
  return data as T;
}

export const rupees = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;
export const timeOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
export const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

/** Downloads a file from an authenticated endpoint (a plain link cannot send the login token). */
export async function downloadFile(path: string, fallbackName: string) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d?.error ?? 'Download failed'); }
  const blob = await res.blob();
  const name = (res.headers.get('Content-Disposition') ?? '').match(/filename="?([^";]+)"?/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** Saves rows as a CSV file that opens in Excel (UTF-8 with BOM). */
export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const blob = new Blob(['\uFEFF' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
