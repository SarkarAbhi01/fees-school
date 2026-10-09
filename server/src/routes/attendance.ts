import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import multer from 'multer';
import { prisma } from '../prisma';
import { authenticate, readerKey, requireRole } from '../middleware/auth';
import { isDuplicate } from '../lib/scanCache';
import { addClient, broadcast } from '../lib/sse';
import { enqueue } from '../lib/jobQueue';
import { Prisma } from '@prisma/client';
import { formatLocalTime, isLate, lateAfterMinutes, localDateOnly, parseDateOnly, tzOffsetMin } from '../lib/time';
import { parseOff, schoolDays } from '../lib/schoolDays';
import { attendanceCounts } from '../lib/presence';
import { dateStr } from '../lib/time';
import { HttpError, classSort, pageParams, schoolId, wrap } from '../lib/util';
import { parseFlexDate, parseTimeMinutes, readRows } from '../lib/sheet';
import { attendanceTemplate } from '../lib/templates';

export const attendanceRouter = Router();

/* ---------- UHF reader endpoint (no JWT, uses x-reader-key) ---------- */
attendanceRouter.post('/scan', readerKey, wrap(async (req, res) => {
  const rfid_uid = String(req.body?.rfid_uid ?? '').trim();
  if (!rfid_uid) return res.status(400).json({ error: 'rfid_uid required' });

  // 1. duplicate block (native Map, 60s)
  if (isDuplicate(rfid_uid)) return res.json({ status: 'duplicate' });

  // 2. student lookup (small select)
  const student = await prisma.student.findUnique({
    where: { rfid_uid },
    select: { id: true, school_id: true, name: true, class: true, unique_no: true, parent_phone: true, is_active: true },
  });
  if (!student || !student.is_active) return res.status(404).json({ error: 'Unknown card' });

  const ts = req.body?.timestamp ? new Date(req.body.timestamp) : new Date();
  const scanTime = isNaN(ts.getTime()) ? new Date() : ts;
  const date = localDateOnly(scanTime);

  // 3. today's attendance
  const existing = await prisma.attendance.findUnique({
    where: { student_id_date: { student_id: student.id, date } },
    select: { id: true, out_time: true },
  });

  let type: 'IN' | 'OUT' | null = null;
  if (!existing) {
    await prisma.attendance.create({
      data: { school_id: student.school_id, student_id: student.id, date, in_time: scanTime, status: isLate(scanTime) ? 'LATE' : 'PRESENT' },
    });
    type = 'IN';
  } else if (!existing.out_time) {
    await prisma.attendance.update({ where: { id: existing.id }, data: { out_time: scanTime } });
    type = 'OUT';
  }

  // 4. raw log
  await prisma.attendanceLog.create({ data: { school_id: student.school_id, rfid_uid, scan_time: scanTime } });

  if (!type) return res.json({ status: 'already_checked_out' });

  // 5. live feed + parent notification
  const time = formatLocalTime(scanTime);
  const verb = type === 'IN' ? 'Entered' : 'Left';
  const late = type === 'IN' && isLate(scanTime);
  broadcast(student.school_id, {
    type, late, name: student.name, class: student.class, unique_no: student.unique_no, time,
    message: `${student.name} - Class ${student.class} - ${verb} ${time}${late ? ' (Late)' : ''}`,
  });
  await enqueue('WHATSAPP', {
    phone: student.parent_phone,
    message: `${student.name} (Class ${student.class}) ${verb.toLowerCase()} school at ${time}.`,
  }, student.school_id);

  res.json({ status: 'ok', type });
}));

/* ---------- live SSE stream ---------- */
attendanceRouter.get('/live-stream', authenticate({ allowQuery: true }), requireRole('SCHOOL_ADMIN', 'TEACHER'), (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  addClient(res, schoolId(req));
});

const guard = [authenticate(), requireRole('SCHOOL_ADMIN', 'TEACHER')];

/* ---------- daily view: GET /api/attendance/daily?date=2026-10-02&class=5&search=&status=&sort=&dir=&page=1 ---------- */
const DAILY_SORTS: Record<string, string> = {
  name: 'LOWER(s.name)', unique_no: 's.unique_no', class: 'LENGTH(s.class), s.class, s.section', in_time: 'a.in_time', status: "COALESCE(a.status, 'ABSENT')",
};
attendanceRouter.get('/daily', ...guard, wrap(async (req, res) => {
  const sid = schoolId(req);
  const date = req.query.date ? parseDateOnly(String(req.query.date)) : localDateOnly();
  const cls = req.query.class ? String(req.query.class) : undefined;
  const search = String(req.query.search ?? '').trim();
  const status = String(req.query.status ?? '').toUpperCase();
  const { page, limit, skip } = pageParams(req);

  const cond: Prisma.Sql[] = [Prisma.sql`s.school_id = ${sid}`, Prisma.sql`s.is_active = true`];
  if (cls) cond.push(Prisma.sql`s.class = ${cls}`);
  if (search) { const like = `%${search}%`; cond.push(Prisma.sql`(s.name ILIKE ${like} OR s.unique_no ILIKE ${like})`); }
  if (['PRESENT', 'LATE', 'ABSENT'].includes(status)) cond.push(Prisma.sql`COALESCE(a.status, 'ABSENT') = ${status}`);
  const where = Prisma.join(cond, ' AND ');
  const dstr = dateStr(date);
  const dir = String(req.query.dir ?? 'asc') === 'desc' ? 'DESC' : 'ASC';
  const sortSql = DAILY_SORTS[String(req.query.sort ?? 'class')] ?? DAILY_SORTS.class;
  const orderBy = Prisma.raw(sortSql.split(', ').map((c) => `${c} ${dir}`).join(', ') + ', s.unique_no');

  const [rows, totalRows, allActive] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT s.id, s.name, s.unique_no, s.class, s.section, a.in_time, a.out_time, COALESCE(a.status, 'ABSENT') AS status
      FROM "Student" s LEFT JOIN "Attendance" a ON a.student_id = s.id AND a.date = ${dstr}::date
      WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${skip}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Student" s LEFT JOIN "Attendance" a ON a.student_id = s.id AND a.date = ${dstr}::date WHERE ${where}`,
    prisma.student.count({ where: { school_id: sid, is_active: true, ...(cls ? { class: cls } : {}) } }),
  ]);
  const total = Number(totalRows[0]?.n ?? 0);

  // summary for the whole class (not just this page)
  const counts = await attendanceCounts(sid, date, cls);
  const totalPresent = Math.min(counts.present, allActive);
  const totalLate = Math.min(counts.late, totalPresent);
  const days = await schoolDays(sid, date.getUTCFullYear(), date.getUTCMonth() + 1);

  res.json({
    data: rows,
    summary: { total_students: allActive, total_present: totalPresent, total_late: totalLate, total_absent: allActive - totalPresent, total_days: days.total, month: date.getUTCMonth() + 1, year: date.getUTCFullYear() },
    total, page, limit,
  });
}));

/* ---------- monthly report (absent computed on the fly) ---------- */
attendanceRouter.get('/report', ...guard, wrap(async (req, res) => {
  const sid = schoolId(req);
  const cls = String(req.query.class ?? '');
  const month = parseInt(String(req.query.month), 10);
  const year = parseInt(String(req.query.year), 10);
  if (!(month >= 1 && month <= 12) || !year) return res.status(400).json({ error: 'month(1-12), year required' });
  const { page, limit, skip } = pageParams(req);

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const sd = await schoolDays(sid, year, month);
  const totalDays = sd.total;

  const where = { school_id: sid, is_active: true, ...(cls ? { class: cls } : {}) };
  const [students, total] = await Promise.all([
    prisma.student.findMany({ where, select: { id: true, unique_no: true, name: true, class: true }, orderBy: [{ class: 'asc' }, { unique_no: 'asc' }], skip, take: limit }),
    prisma.student.count({ where }),
  ]);

  // only count days that are school days, so a stray record on a holiday cannot push a student above 100%
  const dayList = sd.days.map((d) => parseDateOnly(d));
  const counts = dayList.length ? await prisma.attendance.groupBy({
    by: ['student_id', 'status'],
    where: { school_id: sid, student_id: { in: students.map((s) => s.id) }, date: { in: dayList, gte: from, lte: to }, status: { in: ['PRESENT', 'LATE'] } },
    _count: { _all: true },
  }) : [];
  const present = new Map<string, number>(), late = new Map<string, number>();
  for (const c of counts) {
    present.set(c.student_id, (present.get(c.student_id) ?? 0) + c._count._all); // present = on time + late
    if (c.status === 'LATE') late.set(c.student_id, c._count._all);
  }

  res.json({
    class: cls, month, year, total_days_in_month: totalDays, holidays: sd.holidays,
    data: students.map((s) => {
      const p = present.get(s.id) ?? 0;
      return {
        student_id: s.id, unique_no: s.unique_no, name: s.name, class: s.class,
        total_days: totalDays, total_present_days: p, total_late_days: Math.min(late.get(s.id) ?? 0, p), total_absent_days: Math.max(totalDays - p, 0),
        percentage: totalDays ? Math.round((p / totalDays) * 1000) / 10 : 0,
      };
    }),
    total, page, limit,
  });
}));

/* ---------- bulk mark (tick = present, untick = absent) ----------
   { date, items: [{ student_id, status }] }                       -> exactly these students
   { date, all: true, class?, status: PRESENT | ABSENT }          -> every active student of the class (or school)  */
const MARK_STATUS = ['PRESENT', 'ABSENT', 'LATE'];
attendanceRouter.post('/mark-bulk', ...guard, wrap(async (req, res) => {
  const sid = schoolId(req);
  const date = parseDateOnly(String(req.body?.date ?? ''));
  if (date.getTime() > localDateOnly().getTime()) return res.status(400).json({ error: 'You cannot mark attendance for a future date' });

  if (req.body?.all) {
    const status = String(req.body?.status ?? '').toUpperCase();
    if (!['PRESENT', 'ABSENT'].includes(status)) return res.status(400).json({ error: 'status must be PRESENT or ABSENT' });
    const cls = req.body?.class ? String(req.body.class) : undefined;
    const students = await prisma.student.findMany({ where: { school_id: sid, is_active: true, ...(cls ? { class: cls } : {}) }, select: { id: true } });
    const ids = students.map((s) => s.id);
    let changed = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      if (status === 'PRESENT') {
        const have = await prisma.attendance.findMany({ where: { school_id: sid, date, student_id: { in: chunk } }, select: { student_id: true, status: true } });
        const haveIds = new Set(have.map((h) => h.student_id));
        const created = await prisma.attendance.createMany({ data: chunk.filter((id) => !haveIds.has(id)).map((student_id) => ({ school_id: sid, student_id, date, status: 'PRESENT' })), skipDuplicates: true });
        const upd = await prisma.attendance.updateMany({ where: { school_id: sid, date, student_id: { in: chunk }, status: 'ABSENT' }, data: { status: 'PRESENT' } }); // a LATE student stays late (still present)
        changed += created.count + upd.count;
      } else {
        const upd = await prisma.attendance.updateMany({ where: { school_id: sid, date, student_id: { in: chunk }, status: { not: 'ABSENT' } }, data: { status: 'ABSENT', in_time: null, out_time: null } });
        changed += upd.count;
      }
    }
    return res.json({ ok: true, students: ids.length, changed });
  }

  const items: { student_id: string; status: string }[] = (Array.isArray(req.body?.items) ? req.body.items : [])
    .map((i: any) => ({ student_id: String(i?.student_id ?? ''), status: String(i?.status ?? '').toUpperCase() }));
  if (!items.length || items.length > 1000 || !items.every((i) => i.student_id && MARK_STATUS.includes(i.status))) return res.status(400).json({ error: 'items: up to 1000 of { student_id, status: PRESENT | LATE | ABSENT }' });
  const found = await prisma.student.findMany({ where: { school_id: sid, id: { in: items.map((i) => i.student_id) } }, select: { id: true } });
  const ok = new Set(found.map((f) => f.id));
  const writes = items.filter((i) => ok.has(i.student_id)).map((i) => prisma.attendance.upsert({
    where: { student_id_date: { student_id: i.student_id, date } },
    update: i.status === 'ABSENT' ? { status: 'ABSENT', in_time: null, out_time: null } : { status: i.status },
    create: { school_id: sid, student_id: i.student_id, date, status: i.status },
  }));
  for (let i = 0; i < writes.length; i += 200) await prisma.$transaction(writes.slice(i, i + 200));
  res.json({ ok: true, saved: writes.length });
}));

/* ---------- holidays + weekly off (they decide "Total days this month") ---------- */
attendanceRouter.get('/holidays', ...guard, wrap(async (req, res) => {
  const sid = schoolId(req);
  const [school, list] = await Promise.all([
    prisma.school.findUnique({ where: { id: sid }, select: { weekly_off: true } }),
    prisma.holiday.findMany({ where: { school_id: sid }, orderBy: { date: 'desc' }, take: 200 }),
  ]);
  res.json({ weekly_off: parseOff(school?.weekly_off), data: list.map((h) => ({ id: h.id, date: dateStr(h.date), name: h.name })) });
}));
attendanceRouter.post('/holidays', authenticate(), requireRole('SCHOOL_ADMIN'), wrap(async (req, res) => {
  const sid = schoolId(req);
  const date = parseDateOnly(String(req.body?.date ?? ''));
  const name = String(req.body?.name ?? '').trim().slice(0, 60) || 'Holiday';
  await prisma.holiday.upsert({ where: { school_id_date: { school_id: sid, date } }, update: { name }, create: { school_id: sid, date, name } });
  res.status(201).json({ ok: true });
}));
attendanceRouter.delete('/holidays/:id', authenticate(), requireRole('SCHOOL_ADMIN'), wrap(async (req, res) => {
  const r = await prisma.holiday.deleteMany({ where: { id: req.params.id, school_id: schoolId(req) } });
  if (!r.count) return res.status(404).json({ error: 'Holiday not found' });
  res.json({ ok: true });
}));
attendanceRouter.put('/weekly-off', authenticate(), requireRole('SCHOOL_ADMIN'), wrap(async (req, res) => {
  const days: number[] = (Array.isArray(req.body?.days) ? req.body.days : []).map((x: unknown) => Number(x));
  if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || days.length > 3) return res.status(400).json({ error: 'Choose up to 3 weekly off days' });
  await prisma.school.update({ where: { id: schoolId(req) }, data: { weekly_off: [...new Set(days)].join(',') } });
  res.json({ ok: true });
}));

/* ---------- manual mark ---------- */
attendanceRouter.post('/mark-manual', authenticate(), requireRole('SCHOOL_ADMIN', 'TEACHER'), wrap(async (req, res) => {
  const { student_id, date, status } = req.body ?? {};
  if (!student_id || !date || !['PRESENT', 'ABSENT', 'LATE'].includes(status))
    return res.status(400).json({ error: 'student_id, date (YYYY-MM-DD), status (PRESENT|ABSENT|LATE) required' });

  const sid = schoolId(req);
  const student = await prisma.student.findFirst({ where: { id: student_id, school_id: sid }, select: { id: true } });
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const d = parseDateOnly(String(date));
  const rec = await prisma.attendance.upsert({
    where: { student_id_date: { student_id, date: d } },
    update: { status },
    create: { school_id: sid, student_id, date: d, status },
  });
  res.json(rec);
}));

/* ---------- Excel sheet (pre-filled with the class list) ---------- */
/* GET /api/attendance/template.xlsx?date=2026-10-03&class=5   (no class = every class; no date = a blank date column) */
attendanceRouter.get('/template.xlsx', ...guard, wrap(async (req, res) => {
  const sid = schoolId(req);
  const cls = req.query.class ? String(req.query.class) : undefined;
  const date = req.query.date ? parseDateOnly(String(req.query.date)) : undefined;
  const blank = req.query.blank === '1';
  const students = blank ? [] : await prisma.student.findMany({
    where: { school_id: sid, is_active: true, ...(cls ? { class: cls } : {}) },
    select: { unique_no: true, name: true, class: true }, orderBy: [{ unique_no: 'asc' }], take: 5000,
  });
  students.sort((a, b) => classSort(a.class, b.class) || a.unique_no.localeCompare(b.unique_no));
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${blank ? 'Attendance_Template' : `Attendance_${cls ? `Class${cls}_` : ''}${date ? date.toISOString().slice(0, 10) : 'sheet'}`}.xlsx"`,
  });
  res.send(await attendanceTemplate({ date, students }));
}));

/* ---------- bulk upload (.xlsx or .csv): unique_no, date, status [, in_time, out_time] ---------- */
const upload = multer({
  dest: os.tmpdir(), limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (/\.(xlsx|csv)$/i.test(file.originalname) ? cb(null, true) : cb(new HttpError(400, 'Upload an Excel (.xlsx) or CSV (.csv) file') as any)),
});
const MAX_ROWS = 20000;
const STATUS: Record<string, 'PRESENT' | 'ABSENT' | 'LATE'> = { P: 'PRESENT', PRESENT: 'PRESENT', A: 'ABSENT', ABSENT: 'ABSENT', L: 'LATE', LATE: 'LATE' };

attendanceRouter.post('/bulk-upload', ...guard, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Excel or CSV file required (field name: file)' });
  const sid = schoolId(req);
  const today = localDateOnly();
  const errors: { row: number; message: string }[] = [];
  let read = 0, blank = 0, invalid = 0, rowNo = 1;
  const bad = (message: string) => { invalid++; if (errors.length < 25) errors.push({ row: rowNo, message }); };

  type Item = { row: number; unique_no: string; date: Date; status: 'PRESENT' | 'ABSENT' | 'LATE'; inMin: number | null; outMin: number | null };
  const items: Item[] = [];
  try {
    for await (const r of readRows({ path: req.file.path, originalname: req.file.originalname })) {
      rowNo++; read++;
      if (read > MAX_ROWS) throw new HttpError(400, `Too many rows (maximum ${MAX_ROWS} per file). Split the file and upload again.`);
      const unique_no = (r.unique_no ?? '').trim().toUpperCase();
      const statusRaw = (r.status ?? '').trim().toUpperCase();
      if (!unique_no && !statusRaw && !r.date && !r.in_time) { blank++; continue; }
      if (!unique_no) { bad('unique_no is missing'); continue; }
      if (!statusRaw && !(r.in_time ?? '').trim()) { blank++; continue; }               // nothing filled in for this student: skip
      const date = parseFlexDate(r.date ?? '');
      if (!date) { bad(`${unique_no}: date must look like 2026-10-03 or 03/10/2026`); continue; }
      if (date > today) { bad(`${unique_no}: date is in the future`); continue; }
      const inMin = (r.in_time ?? '').trim() ? parseTimeMinutes(r.in_time) : null;
      const outMin = (r.out_time ?? '').trim() ? parseTimeMinutes(r.out_time) : null;
      if ((r.in_time ?? '').trim() && inMin === null) { bad(`${unique_no}: in_time must look like 08:15`); continue; }
      if ((r.out_time ?? '').trim() && outMin === null) { bad(`${unique_no}: out_time must look like 14:30`); continue; }
      if (inMin !== null && outMin !== null && outMin <= inMin) { bad(`${unique_no}: out_time must be after in_time`); continue; }
      let status = STATUS[statusRaw];
      if (statusRaw && !status) { bad(`${unique_no}: status must be PRESENT, LATE or ABSENT`); continue; }
      if (!status) status = (inMin as number) > lateAfterMinutes() ? 'LATE' : 'PRESENT';   // no status, but a time was given
      items.push({ row: rowNo, unique_no, date, status, inMin, outMin });
    }
  } finally {
    fs.unlink(req.file.path, () => {});
  }

  // find the students (this school only), 500 at a time
  const ids = new Map<string, string>();
  const wanted = [...new Set(items.map((i) => i.unique_no))];
  for (let i = 0; i < wanted.length; i += 500) {
    const found = await prisma.student.findMany({ where: { school_id: sid, unique_no: { in: wanted.slice(i, i + 500) } }, select: { id: true, unique_no: true } });
    found.forEach((f) => ids.set(f.unique_no.toUpperCase(), f.id));
  }

  const toInstant = (d: Date, min: number | null) => (min === null ? null : new Date(d.getTime() + (min - tzOffsetMin()) * 60000));
  const writes: ReturnType<typeof prisma.attendance.upsert>[] = [];
  const done = new Set<string>();
  for (const it of items) {
    const student_id = ids.get(it.unique_no);
    if (!student_id) { rowNo = it.row; bad(`${it.unique_no}: student not found`); continue; }
    const key = `${student_id}|${it.date.getTime()}`;
    if (done.has(key)) { rowNo = it.row; bad(`${it.unique_no}: appears twice for the same date - keep one row per student per day`); continue; }
    done.add(key);
    const absent = it.status === 'ABSENT';
    const in_time = absent ? null : toInstant(it.date, it.inMin);
    const out_time = absent ? null : toInstant(it.date, it.outMin);
    writes.push(prisma.attendance.upsert({
      where: { student_id_date: { student_id, date: it.date } },
      update: { status: it.status, ...(absent ? { in_time: null, out_time: null } : { ...(in_time ? { in_time } : {}), ...(out_time ? { out_time } : {}) }) },
      create: { school_id: sid, student_id, date: it.date, status: it.status, in_time, out_time },
    }));
  }
  let saved = 0;
  for (let i = 0; i < writes.length; i += 200) { await prisma.$transaction(writes.slice(i, i + 200)); saved += Math.min(200, writes.length - i); }

  errors.sort((a, b) => a.row - b.row); // problems in the order they appear in the sheet
  res.json({ rows_read: read, saved, skipped_blank: blank, invalid_rows: invalid, errors });
}));
