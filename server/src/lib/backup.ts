import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import ExcelJS from 'exceljs';
import { prisma } from '../prisma';
import { driveMode, uploadToDrive } from './drive';
import { dateStr, localDateOnly, localParts, localRangeInstants, tzOffsetMin } from './time';

/* ---------------- what can be backed up ---------------- */

export interface Dataset { key: string; label: string; tables: string[] }
export const DATASETS: Dataset[] = [
  { key: 'school', label: 'School profile and plan', tables: ['School', 'Holiday'] },
  { key: 'users', label: 'Staff logins (no passwords)', tables: ['User'] },
  { key: 'students', label: 'Students', tables: ['Student'] },
  { key: 'attendance', label: 'Attendance and gate scans', tables: ['Attendance', 'AttendanceLog'] },
  { key: 'fee_setup', label: 'Fee heads, structure, months, custom fees, discounts', tables: ['FeeHead', 'ClassFee', 'FeeMonthMap', 'StudentFee', 'Discount', 'StudentDiscount', 'FeeStructure'] },
  { key: 'fee_payments', label: 'Fee receipts, receipt lines, other discounts', tables: ['FeePayment', 'FeePaymentLine', 'DiscountEntry'] },
];
export const ALL_DATASET_KEYS = DATASETS.map((d) => d.key);
export const RANGES = ['ALL', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export const FREQS = ['OFF', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;

interface TableDef { model: string; tenant: 'id' | 'school_id'; date?: string }
const TABLES: Record<string, TableDef> = {
  School: { model: 'school', tenant: 'id' }, Holiday: { model: 'holiday', tenant: 'school_id' },
  User: { model: 'user', tenant: 'school_id' }, Student: { model: 'student', tenant: 'school_id' },
  Attendance: { model: 'attendance', tenant: 'school_id', date: 'date' }, AttendanceLog: { model: 'attendanceLog', tenant: 'school_id', date: 'scan_time' },
  FeeHead: { model: 'feeHead', tenant: 'school_id' }, ClassFee: { model: 'classFee', tenant: 'school_id' }, FeeMonthMap: { model: 'feeMonthMap', tenant: 'school_id' },
  StudentFee: { model: 'studentFee', tenant: 'school_id' }, Discount: { model: 'discount', tenant: 'school_id' }, StudentDiscount: { model: 'studentDiscount', tenant: 'school_id' },
  FeeStructure: { model: 'feeStructure', tenant: 'school_id' },
  FeePayment: { model: 'feePayment', tenant: 'school_id', date: 'payment_date' }, FeePaymentLine: { model: 'feePaymentLine', tenant: 'school_id' },
  DiscountEntry: { model: 'discountEntry', tenant: 'school_id', date: 'createdAt' },
};
/** Every table, for the .bak file (the whole scope, whatever datasets were ticked). */
const BAK_TABLES = Object.keys(TABLES);

const delegate = (t: string) => (prisma as any)[TABLES[t].model];
const SECRET: Record<string, string[]> = { User: ['password'] };

/** Window for time based tables. ALL = no limit. DAY/WEEK/MONTH/YEAR = the current day / week (Mon-) / month / financial year up to now. */
export function windowOf(range: string) {
  if (range === 'ALL') return null;
  const today = localDateOnly();
  let from = today;
  if (range === 'WEEK') from = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86400000);
  else if (range === 'MONTH') from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  else if (range === 'YEAR') from = new Date(Date.UTC(today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 3, 1));
  return { from, to: today, ...localRangeInstants(from, today) };
}

/** Rows of one table, 2000 at a time (id cursor), so a big table never sits in memory. */
async function* rowsOf(table: string, school: string | null, range: string, hideSecrets: boolean): AsyncGenerator<Record<string, any>> {
  const def = TABLES[table], w = windowOf(range);
  const where: any = {};
  if (school) where[def.tenant] = school;
  let paymentIds: string[] | null = null;
  if (w && def.date) where[def.date] = def.date === 'date' ? { gte: w.from, lte: w.to } : { gte: w.start, lt: w.end };
  if (w && table === 'FeePaymentLine') {
    const ids = (await prisma.feePayment.findMany({ where: { ...(school ? { school_id: school } : {}), payment_date: { gte: w.start, lt: w.end } }, select: { id: true } })).map((p) => p.id);
    if (!ids.length) return;
    paymentIds = ids;
  }
  let cursor: string | undefined;
  for (;;) {
    const batch: any[] = await delegate(table).findMany({
      where: paymentIds ? { ...where, payment_id: { in: paymentIds } } : where, orderBy: { id: 'asc' }, take: 2000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) return;
    for (const r of batch) { if (hideSecrets) for (const k of SECRET[table] ?? []) delete r[k]; yield r; }
    cursor = batch[batch.length - 1].id;
    if (batch.length < 2000) return;
  }
}

/* ---------------- file writers ---------------- */

async function writeExcel(file: string, tables: string[], school: string | null, range: string) {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: false, useSharedStrings: false });
  const flat = (v: unknown) => (v instanceof Date ? v : v !== null && typeof v === 'object' ? JSON.stringify(v) : typeof v === 'bigint' ? Number(v) : v);
  for (const t of tables) {
    const ws = wb.addWorksheet(t);
    let headed = false;
    for await (const r of rowsOf(t, school, range, true)) {
      if (!headed) { ws.addRow(Object.keys(r)).commit(); headed = true; }
      ws.addRow(Object.values(r).map(flat)).commit();
    }
    if (!headed) ws.addRow(['(no rows)']).commit();
    ws.commit();
  }
  await wb.commit();
}

async function writeJson(file: string, tables: string[], school: string | null, range: string, meta: Record<string, unknown>) {
  const out = fs.createWriteStream(file, { encoding: 'utf8' });
  const put = (s: string) => new Promise<void>((res, rej) => { out.write(s, (e) => (e ? rej(e) : res())); });
  await put(`{"meta":${JSON.stringify(meta)},"tables":{`);
  let firstT = true;
  for (const t of tables) {
    await put(`${firstT ? '' : ','}${JSON.stringify(t)}:[`); firstT = false;
    let first = true;
    for await (const r of rowsOf(t, school, range, true)) { await put(`${first ? '' : ','}${JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))}`); first = false; }
    await put(']');
  }
  await put('}}\n');
  await new Promise<void>((res) => out.end(res));
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
function lit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Plain SQL file: restore with  psql "$DATABASE_URL" -f file.bak  (tables must already exist: npm run db:deploy). Includes password hashes, keep it private. */
async function writeSqlBak(file: string, school: string | null) {
  const out = fs.createWriteStream(file, { encoding: 'utf8' });
  const put = (s: string) => new Promise<void>((res, rej) => { out.write(s, (e) => (e ? rej(e) : res())); });
  await put(`-- School ERP backup ${new Date().toISOString()} | scope: ${school ?? 'ALL SCHOOLS'}\n-- Restore into a database created with "npm run db:deploy":  psql "<DATABASE_URL>" -f this_file.bak\nBEGIN;\n`);
  for (const t of BAK_TABLES) {
    let batch: Record<string, any>[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const cols = Object.keys(batch[0]);
      await put(`INSERT INTO ${q(t)} (${cols.map(q).join(', ')}) VALUES\n${batch.map((r) => `(${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n')}\nON CONFLICT DO NOTHING;\n`);
      batch = [];
    };
    for await (const r of rowsOf(t, school, 'ALL', false)) { batch.push(r); if (batch.length >= 200) await flush(); }
    await flush();
  }
  await put('COMMIT;\n');
  await new Promise<void>((res) => out.end(res));
}

/** Whole database with the real pg_dump (custom format). Returns false when pg_dump is not installed. */
function pgDump(file: string) {
  return new Promise<boolean>((resolve) => {
    const raw = process.env.DATABASE_URL;
    if (!raw) return resolve(false);
    let url: string;
    try { const u = new URL(raw); u.searchParams.delete('schema'); url = u.toString(); } catch { return resolve(false); }
    execFile(process.env.PG_DUMP_PATH || 'pg_dump', ['--format=custom', '--no-owner', '--file', file, url], { timeout: 30 * 60000 }, (err) => resolve(!err));
  });
}

/* ---------------- run one backup ---------------- */

export const backupDir = () => path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'));
const MIME = { EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', JSON: 'application/json', BAK: 'application/octet-stream' } as const;
const EXT = { EXCEL: 'xlsx', JSON: 'json', BAK: 'bak' } as const;
const running = new Set<string>();

export interface RunOpts {
  scope: string; school_id: string | null; datasets: string[]; range: string; period: string; trigger: 'AUTO' | 'MANUAL';
  make_excel: boolean; make_json: boolean; make_bak: boolean; to_drive: boolean; by: string; keep_last?: number;
}

export async function runBackup(o: RunOpts) {
  if (running.has(o.scope)) throw new Error('A backup is already running for this school. Wait for it to finish.');
  running.add(o.scope);
  try {
    const keys = o.datasets.filter((k) => ALL_DATASET_KEYS.includes(k));
    if (!keys.length && (o.make_excel || o.make_json)) throw new Error('Tick at least one thing to back up');
    if (!o.make_excel && !o.make_json && !o.make_bak) throw new Error('Choose at least one file type: Excel, JSON or .bak');
    const tables = DATASETS.filter((d) => keys.includes(d.key)).flatMap((d) => d.tables);
    const label = o.school_id ? ((await prisma.school.findUnique({ where: { id: o.school_id }, select: { code: true } }))?.code ?? o.school_id) : 'PLATFORM';
    const dir = path.join(backupDir(), o.scope);
    await fs.promises.mkdir(dir, { recursive: true });
    const p = localParts();
    const stamp = `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}_${String(p.h).padStart(2, '0')}${String(p.min).padStart(2, '0')}`;
    const base = `${label}_${o.period === 'MANUAL' ? 'manual' : o.period.toLowerCase()}_${stamp}`;
    const meta = { app: 'School ERP', scope: label, created: new Date().toISOString(), range: o.range, datasets: keys, tz_offset_min: tzOffsetMin(), range_from: windowOf(o.range) ? dateStr(windowOf(o.range)!.from) : null };

    const made: { kind: 'EXCEL' | 'JSON' | 'BAK'; file: string; name: string; note?: string }[] = [];
    const add = (kind: 'EXCEL' | 'JSON' | 'BAK', ext?: string) => { const name = `${base}.${ext ?? EXT[kind]}`; const r = { kind, file: path.join(dir, name), name }; made.push(r); return r; };
    if (o.make_excel) await writeExcel(add('EXCEL').file, tables, o.school_id, o.range);
    if (o.make_json) await writeJson(add('JSON').file, tables, o.school_id, o.range, meta);
    if (o.make_bak) {
      const b = add('BAK');
      // whole platform: real pg_dump when installed, otherwise the same portable SQL file a school gets
      if (!(o.school_id === null && (await pgDump(b.file)))) await writeSqlBak(b.file, o.school_id);
    }

    const drive = driveMode();
    const rows = [];
    for (const m of made) {
      const size = (await fs.promises.stat(m.file)).size;
      let drive_status = 'NONE', drive_id: string | null = null, drive_error = '';
      if (o.to_drive) {
        try { if (!drive) throw new Error('Google Drive is not set up on the server'); drive_id = await uploadToDrive(m.file, m.name, MIME[m.kind], label); drive_status = 'UPLOADED'; }
        catch (e: any) { drive_status = 'FAILED'; drive_error = String(e?.message ?? e).slice(0, 300); }
      }
      rows.push(await prisma.backupFile.create({ data: { scope: o.scope, school_id: o.school_id, kind: m.kind, file_name: m.name, size, period: o.period, trigger: o.trigger, created_by: o.by, drive_status, drive_id, drive_error } }));
    }
    if (o.trigger === 'AUTO' && o.keep_last) await prune(o.scope, o.keep_last);
    return rows;
  } finally { running.delete(o.scope); }
}

/** Automatic backups: keep the newest N files of each kind, delete older ones from disk (Drive copies stay). */
async function prune(scope: string, keep: number) {
  for (const kind of ['EXCEL', 'JSON', 'BAK']) {
    const old = await prisma.backupFile.findMany({ where: { scope, kind, trigger: 'AUTO' }, orderBy: { createdAt: 'desc' }, skip: Math.max(1, keep), select: { id: true, file_name: true } });
    for (const f of old) { await fs.promises.rm(path.join(backupDir(), scope, f.file_name), { force: true }); await prisma.backupFile.delete({ where: { id: f.id } }); }
  }
}

/* ---------------- scheduler ---------------- */

/** Most recent moment this schedule should have run (school time), or null. DAILY every day, WEEKLY Sunday, MONTHLY last day of month, YEARLY 31 March. */
export function lastScheduled(freq: string, runTime: string, now = new Date()) {
  const [hh, mm] = runTime.split(':').map(Number);
  const off = tzOffsetMin() * 60000;
  const today = localDateOnly(now);
  for (let back = 0; back <= 400; back++) {
    const d = new Date(today.getTime() - back * 86400000);
    const dow = d.getUTCDay(), last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const hit = freq === 'DAILY' || (freq === 'WEEKLY' && dow === 0) || (freq === 'MONTHLY' && d.getUTCDate() === last) || (freq === 'YEARLY' && d.getUTCMonth() === 2 && d.getUTCDate() === 31);
    if (!hit) continue;
    const at = new Date(d.getTime() + (hh * 60 + mm) * 60000 - off);
    if (at <= now) return at;
  }
  return null;
}

let timer: NodeJS.Timeout | undefined;
async function schedulerTick() {
  const configs = await prisma.backupConfig.findMany({ where: { frequency: { not: 'OFF' } } });
  for (const c of configs) {
    try {
      const due = lastScheduled(c.frequency, c.run_time);
      const baseline = c.last_run_at ?? c.updatedAt;
      if (!due || due <= baseline) continue;
      if (c.school_id && !(await prisma.school.findUnique({ where: { id: c.school_id }, select: { is_active: true } }))?.is_active) continue;
      const keys = Array.isArray(c.datasets) ? (c.datasets as string[]) : ALL_DATASET_KEYS;
      await prisma.backupConfig.update({ where: { id: c.id }, data: { last_run_at: new Date(), last_status: 'RUNNING', last_error: '' } });
      try {
        await runBackup({ scope: c.scope, school_id: c.school_id, datasets: keys, range: c.range, period: c.frequency, trigger: 'AUTO', make_excel: c.make_excel, make_json: c.make_json, make_bak: c.make_bak, to_drive: c.to_drive, by: 'Automatic', keep_last: c.keep_last });
        await prisma.backupConfig.update({ where: { id: c.id }, data: { last_status: 'OK' } });
      } catch (e: any) {
        await prisma.backupConfig.update({ where: { id: c.id }, data: { last_status: 'FAILED', last_error: String(e?.message ?? e).slice(0, 300) } });
      }
    } catch (e) { console.error('[backup] scheduler error', e); }
  }
}
export function startBackupScheduler() {
  if (timer) return;
  timer = setInterval(() => { schedulerTick().catch((e) => console.error('[backup] tick', e)); }, 60000);
  timer.unref();
}
