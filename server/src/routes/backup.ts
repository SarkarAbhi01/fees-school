import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { HttpError, wrap } from '../lib/util';
import { ALL_DATASET_KEYS, DATASETS, FREQS, RANGES, backupDir, runBackup } from '../lib/backup';
import { driveMode } from '../lib/drive';

export const backupRouter = Router();
backupRouter.use(authenticate(), requireRole('SCHOOL_ADMIN', 'SUPER_ADMIN'));

/** School admin: always their own school. Super admin: ?school_id=<id> for one school, nothing for the whole platform. */
async function scopeOf(req: any) {
  const u = req.user!;
  if (u.role === 'SCHOOL_ADMIN') return { scope: u.school_id as string, school_id: u.school_id as string };
  const id = String(req.query.school_id ?? req.body?.school_id ?? '').trim();
  if (!id) return { scope: 'PLATFORM', school_id: null as string | null };
  if (!(await prisma.school.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, 'School not found');
  return { scope: id, school_id: id };
}
const keysOf = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((k) => ALL_DATASET_KEYS.includes(k)) : ALL_DATASET_KEYS);
const bool = (v: unknown, d: boolean) => (v === undefined ? d : !!v);

backupRouter.get('/config', wrap(async (req, res) => {
  const { scope, school_id } = await scopeOf(req);
  const c = await prisma.backupConfig.findUnique({ where: { scope } });
  res.json({
    scope, school_id, datasets_available: DATASETS.map((d) => ({ key: d.key, label: d.label })),
    config: {
      frequency: c?.frequency ?? 'OFF', run_time: c?.run_time ?? '23:30', range: c?.range ?? 'ALL', datasets: Array.isArray(c?.datasets) ? c!.datasets : ALL_DATASET_KEYS,
      make_excel: c?.make_excel ?? true, make_json: c?.make_json ?? true, make_bak: c?.make_bak ?? true, to_drive: c?.to_drive ?? false, keep_last: c?.keep_last ?? 30,
      last_run_at: c?.last_run_at ?? null, last_status: c?.last_status ?? '', last_error: c?.last_error ?? '',
    },
    drive: { configured: !!driveMode(), mode: driveMode() },
  });
}));

backupRouter.put('/config', wrap(async (req, res) => {
  const { scope, school_id } = await scopeOf(req);
  const b = req.body ?? {};
  const frequency = String(b.frequency ?? 'OFF').toUpperCase(), range = String(b.range ?? 'ALL').toUpperCase(), run_time = String(b.run_time ?? '23:30');
  if (!(FREQS as readonly string[]).includes(frequency)) return res.status(400).json({ error: 'frequency must be OFF, DAILY, WEEKLY, MONTHLY or YEARLY' });
  if (!(RANGES as readonly string[]).includes(range)) return res.status(400).json({ error: 'Unknown data range' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(run_time)) return res.status(400).json({ error: 'Time must look like 23:30' });
  const keep_last = Math.min(365, Math.max(1, Math.round(Number(b.keep_last) || 30)));
  const data = { school_id, frequency, run_time, range, datasets: keysOf(b.datasets), make_excel: bool(b.make_excel, true), make_json: bool(b.make_json, true), make_bak: bool(b.make_bak, true), to_drive: bool(b.to_drive, false), keep_last };
  if (frequency !== 'OFF' && !data.make_excel && !data.make_json && !data.make_bak) return res.status(400).json({ error: 'Choose at least one file type' });
  await prisma.backupConfig.upsert({ where: { scope }, update: data, create: { scope, ...data } });
  res.json({ ok: true });
}));

/* Backup now */
backupRouter.post('/run', wrap(async (req, res) => {
  const { scope, school_id } = await scopeOf(req);
  const b = req.body ?? {};
  const range = String(b.range ?? 'ALL').toUpperCase();
  if (!(RANGES as readonly string[]).includes(range)) return res.status(400).json({ error: 'Unknown data range' });
  try {
    const files = await runBackup({
      scope, school_id, datasets: keysOf(b.datasets), range, period: 'MANUAL', trigger: 'MANUAL',
      make_excel: bool(b.make_excel, true), make_json: bool(b.make_json, true), make_bak: bool(b.make_bak, true), to_drive: bool(b.to_drive, false), by: req.user!.name,
    });
    res.status(201).json({ files });
  } catch (e: any) { throw new HttpError(400, String(e?.message ?? e)); }
}));

backupRouter.get('/files', wrap(async (req, res) => {
  const { scope } = await scopeOf(req);
  const kind = String(req.query.kind ?? '').toUpperCase();
  const where = { scope, ...(['EXCEL', 'JSON', 'BAK'].includes(kind) ? { kind } : {}) };
  const data = await prisma.backupFile.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ data });
}));

async function ownFile(req: any) {
  const f = await prisma.backupFile.findUnique({ where: { id: req.params.id } });
  if (!f) throw new HttpError(404, 'Backup file not found');
  if (req.user!.role === 'SCHOOL_ADMIN' && f.scope !== req.user!.school_id) throw new HttpError(404, 'Backup file not found');
  return f;
}

backupRouter.get('/files/:id/download', wrap(async (req, res) => {
  const f = await ownFile(req);
  const file = path.join(backupDir(), f.scope, f.file_name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'The file is no longer on the server (old backups are cleaned up automatically)');
  res.download(file, f.file_name);
}));

backupRouter.delete('/files/:id', wrap(async (req, res) => {
  const f = await ownFile(req);
  await fs.promises.rm(path.join(backupDir(), f.scope, f.file_name), { force: true });
  await prisma.backupFile.delete({ where: { id: f.id } });
  res.json({ ok: true });
}));
