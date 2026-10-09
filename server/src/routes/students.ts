import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { HttpError, classSort, pageParams, schoolId, wrap } from '../lib/util';
import { parseFlexDate, readRows } from '../lib/sheet';
import { studentTemplate } from '../lib/templates';

export const studentsRouter = Router();
studentsRouter.use(authenticate());

// multer writes to disk and we stream line-by-line, so the file is never fully in RAM
const upload = multer({
  dest: os.tmpdir(), limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (/\.(xlsx|csv)$/i.test(file.originalname) ? cb(null, true) : cb(new HttpError(400, 'Upload an Excel (.xlsx) or CSV (.csv) file') as any)),
});

async function nextSeq(sid: string, code: string) {
  const last = await prisma.student.findFirst({
    where: { school_id: sid, unique_no: { startsWith: `${code}-` } },
    orderBy: { unique_no: 'desc' }, select: { unique_no: true },
  });
  return last ? parseInt(last.unique_no.split('-').pop() ?? '0', 10) + 1 : 1;
}
const yes = (v: unknown) => ['true', 'yes', 'y', '1'].includes(String(v ?? '').trim().toLowerCase());
/** 2026-07-15 or 15/07/2026 -> UTC-midnight Date, '' / undefined -> null (billing then starts from the beginning of the financial year). */
function optDate(v: unknown) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const d = parseFlexDate(t);
  if (!d) throw new HttpError(400, 'admission_date must look like 2026-07-15 or 15/07/2026');
  return d;
}
const fmt = (code: string, n: number) => `${code}-${String(n).padStart(4, '0')}`;

/* ---------- Excel template for bulk upload ---------- */
studentsRouter.get('/template.xlsx', requireRole('SCHOOL_ADMIN'), wrap(async (_req, res) => {
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="Student_Template.xlsx"' });
  res.send(await studentTemplate());
}));

/* ---------- class-wise counts (the Students screen opens on this, not on every student) ---------- */
studentsRouter.get('/classes', requireRole('SCHOOL_ADMIN', 'TEACHER'), wrap(async (req, res) => {
  const rows = await prisma.student.groupBy({ by: ['class', 'is_active'], where: { school_id: schoolId(req) }, _count: { _all: true } });
  const map = new Map<string, { class: string; active: number; left: number }>();
  for (const r of rows) {
    const e = map.get(r.class) ?? { class: r.class, active: 0, left: 0 };
    if (r.is_active) e.active += r._count._all; else e.left += r._count._all;
    map.set(r.class, e);
  }
  const data = [...map.values()].sort((a, b) => classSort(a.class, b.class));
  res.json({ data, active: data.reduce((t, c) => t + c.active, 0), left: data.reduce((t, c) => t + c.left, 0) });
}));

/* ---------- list / search (max 50 per page) ---------- */
studentsRouter.get('/', requireRole('SCHOOL_ADMIN', 'TEACHER'), wrap(async (req, res) => {
  const sid = schoolId(req);
  const { page, limit, skip } = pageParams(req);
  const search = String(req.query.search ?? '').trim();
  const cls = req.query.class ? String(req.query.class) : undefined;
  const status = String(req.query.status ?? 'active'); // active | left | all

  const where: Prisma.StudentWhereInput = {
    school_id: sid,
    ...(cls ? { class: cls } : {}),
    ...(status === 'active' ? { is_active: true } : status === 'left' ? { is_active: false } : {}),
    ...(search ? { OR: [
      { unique_no: { contains: search, mode: 'insensitive' } },
      { rfid_uid: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { parent_phone: { contains: search } },
    ] } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.student.findMany({
      where, orderBy: { unique_no: 'asc' }, skip, take: limit,
      select: { id: true, unique_no: true, rfid_uid: true, name: true, class: true, section: true, parent_phone: true, photo_url: true, uses_transport: true, admission_date: true, is_active: true },
    }),
    prisma.student.count({ where }),
  ]);
  res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
}));

/* ---------- add single ---------- */
studentsRouter.post('/', requireRole('SCHOOL_ADMIN'), wrap(async (req, res) => {
  const sid = schoolId(req);
  const b = req.body ?? {};
  if (!b.name || !b.class || !b.rfid_uid || !b.parent_phone)
    return res.status(400).json({ error: 'name, class, rfid_uid, parent_phone required' });

  const school = await prisma.school.findUnique({ where: { id: sid }, select: { code: true } });
  const unique_no = b.unique_no ? String(b.unique_no).trim() : fmt(school!.code, await nextSeq(sid, school!.code));
  try {
    const s = await prisma.student.create({
      data: { school_id: sid, unique_no, rfid_uid: String(b.rfid_uid).trim(), name: String(b.name).trim(), class: String(b.class).trim(), section: String(b.section ?? '').trim(), parent_phone: String(b.parent_phone).trim(), uses_transport: yes(b.uses_transport), admission_date: optDate(b.admission_date) },
    });
    res.status(201).json(s);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      return res.status(409).json({ error: 'unique_no or rfid_uid already exists' });
    throw e;
  }
}));

/* ---------- edit admission date / transport / left-school status ---------- */
studentsRouter.patch('/:id', requireRole('SCHOOL_ADMIN'), wrap(async (req, res) => {
  const data: Prisma.StudentUpdateManyMutationInput = {};
  if (req.body?.admission_date !== undefined) data.admission_date = optDate(req.body.admission_date);
  if (req.body?.uses_transport !== undefined) data.uses_transport = !!req.body.uses_transport;
  if (req.body?.is_active !== undefined) data.is_active = !!req.body.is_active; // false = left the school: no more fee collection
  const r = await prisma.student.updateMany({ where: { id: req.params.id, school_id: schoolId(req) }, data });
  if (!r.count) return res.status(404).json({ error: 'Student not found' });
  res.json({ ok: true });
}));

/* ---------- bulk upload (.xlsx or .csv): unique_no, rfid_uid, name, class, parent_phone [, section, uses_transport, admission_date] ---------- */
studentsRouter.post('/bulk-upload', requireRole('SCHOOL_ADMIN'), upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Excel or CSV file required (field name: file)' });
  const sid = schoolId(req);
  const school = await prisma.school.findUnique({ where: { id: sid }, select: { code: true } });
  let seq = await nextSeq(sid, school!.code);

  let batch: Prisma.StudentCreateManyInput[] = [];
  let inserted = 0, read = 0, invalid = 0, rowNo = 1;
  const errors: { row: number; message: string }[] = [];
  const bad = (message: string) => { invalid++; if (errors.length < 25) errors.push({ row: rowNo, message }); };

  const flush = async () => {
    if (!batch.length) return;
    const r = await prisma.student.createMany({ data: batch, skipDuplicates: true });
    inserted += r.count;
    batch = [];
  };

  try {
    for await (const row of readRows({ path: req.file.path, originalname: req.file.originalname })) {
      rowNo++; read++;
      const missing = ['rfid_uid', 'name', 'class'].filter((k) => !row[k]);
      if (missing.length) { bad(`Missing ${missing.join(', ')}`); continue; }
      let admission_date: Date | null = null;
      if (row.admission_date) {
        admission_date = parseFlexDate(row.admission_date);
        if (!admission_date) { bad('admission_date must look like 2026-07-15 or 15/07/2026'); continue; }
      }
      batch.push({
        school_id: sid,
        unique_no: row.unique_no || fmt(school!.code, seq++),
        rfid_uid: row.rfid_uid, name: row.name, class: row.class,
        section: row.section ?? '', parent_phone: row.parent_phone ?? '', uses_transport: yes(row.uses_transport), admission_date,
      });
      if (batch.length >= 500) await flush(); // flat memory: 500 rows at a time
    }
    await flush();
  } finally {
    fs.unlink(req.file.path, () => {});
  }
  res.json({ rows_read: read, inserted, skipped_duplicates: read - invalid - inserted, invalid_rows: invalid, errors });
}));
