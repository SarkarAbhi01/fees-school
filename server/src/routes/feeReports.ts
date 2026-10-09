import { Request, Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { HttpError, classSort, pageParams, schoolId, wrap } from '../lib/util';
import { dateStr, localDateOnly, localRangeInstants, parseDateOnly, tzOffsetMin } from '../lib/time';

/** Fee records (every receipt) and collection reports. Mounted under /api/fees. */
export const feeReportsRouter = Router();
feeReportsRouter.use(authenticate());
const canView = requireRole('SCHOOL_ADMIN', 'FEES_COLLECTOR');

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** today | yesterday | week (Mon-today) | month (1st-today) | custom (from, to) */
function periodOf(req: Request) {
  const preset = String(req.query.period ?? 'today');
  const today = localDateOnly();
  let from = today, to = today;
  if (preset === 'yesterday') { from = to = addDays(today, -1); }
  else if (preset === 'week') { from = addDays(today, -((today.getUTCDay() + 6) % 7)); }
  else if (preset === 'month') { from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); }
  else if (preset === 'custom') {
    try { from = parseDateOnly(String(req.query.from ?? '')); to = parseDateOnly(String(req.query.to ?? '')); }
    catch { throw new HttpError(400, 'Pick a valid from and to date'); }
    if (from > to) throw new HttpError(400, 'From date is after To date');
    if ((to.getTime() - from.getTime()) / 86400000 > 366) throw new HttpError(400, 'Choose a range of at most one year');
  } else if (preset !== 'today') throw new HttpError(400, 'Unknown period');
  const { start, end } = localRangeInstants(from, to);
  return { preset, from: dateStr(from), to: dateStr(to), start, end };
}

/** Shared WHERE for payments (alias p) joined to students (alias s). A collector only ever sees their own collections. */
function conditions(req: Request, sid: string, range: { start: Date; end: Date }) {
  const c: Prisma.Sql[] = [Prisma.sql`p.school_id = ${sid}`, Prisma.sql`p.payment_date >= ${range.start}`, Prisma.sql`p.payment_date < ${range.end}`];
  const cls = String(req.query.class ?? '').trim();
  const mode = String(req.query.mode ?? '').trim().toUpperCase();
  const search = String(req.query.search ?? '').trim();
  if (cls) c.push(Prisma.sql`s.class = ${cls}`);
  if (mode) c.push(Prisma.sql`p.payment_mode = ${mode}`);
  if (search) { const like = `%${search}%`; c.push(Prisma.sql`(p.receipt_no ILIKE ${like} OR s.name ILIKE ${like} OR s.unique_no ILIKE ${like})`); }
  const collector = req.user!.role === 'FEES_COLLECTOR' ? req.user!.id : String(req.query.collector ?? '').trim();
  if (collector) c.push(Prisma.sql`p.collected_by = ${collector}`);
  return Prisma.join(c, ' AND ');
}

const n = (v: unknown) => Number(v ?? 0);

async function filterOptions(req: Request, sid: string) {
  const cls = await prisma.student.groupBy({ by: ['class'], where: { school_id: sid } });
  const collectors = req.user!.role === 'SCHOOL_ADMIN'
    ? await prisma.user.findMany({ where: { school_id: sid, role: { in: ['SCHOOL_ADMIN', 'FEES_COLLECTOR'] } }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    : [];
  return { classes: cls.map((c) => c.class).sort(classSort), collectors };
}

/* ---------------- GET /api/fees/records : every receipt, filters + sorting + paging ---------------- */
const SORTS: Record<string, string> = {
  date: 'p.payment_date', amount: 'p.amount_paid', discount: 'p.discount_amount', receipt: 'p.receipt_no',
  name: 'LOWER(s.name)', class: 'LENGTH(s.class), s.class',
};

feeReportsRouter.get('/records', canView, wrap(async (req, res) => {
  const sid = schoolId(req);
  const range = periodOf(req);
  const where = conditions(req, sid, range);
  const { page, limit, skip } = pageParams(req);
  const sort = SORTS[String(req.query.sort ?? 'date')] ?? SORTS.date;
  const dir = String(req.query.dir ?? 'desc') === 'asc' ? 'ASC' : 'DESC';
  const orderBy = Prisma.raw(sort.split(', ').map((c) => `${c} ${dir}`).join(', ') + ', p.id');

  const [rows, totals, options] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT p.id, p.receipt_no, p.payment_date, p.amount_paid, p.discount_amount, p.pending_amount, p.payment_mode, p.billing_mode, p.months,
             p.reprint_count, p.collected_by, s.name AS student_name, s.unique_no, s.class, s.section, s.is_active
      FROM "FeePayment" p JOIN "Student" s ON s.id = p.student_id
      WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${skip}`,
    prisma.$queryRaw<any[]>`
      SELECT count(*) AS receipts, COALESCE(sum(p.amount_paid), 0) AS collected, COALESCE(sum(p.discount_amount), 0) AS discount
      FROM "FeePayment" p JOIN "Student" s ON s.id = p.student_id WHERE ${where}`,
    filterOptions(req, sid),
  ]);

  const ids = rows.map((r) => r.id as string);
  const userIds = [...new Set(rows.map((r) => r.collected_by).filter(Boolean))] as string[];
  const [lines, users] = await Promise.all([
    ids.length ? prisma.feePaymentLine.findMany({ where: { school_id: sid, payment_id: { in: ids } }, select: { payment_id: true, head_name: true, amount: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);

  res.json({
    range: { period: range.preset, from: range.from, to: range.to },
    totals: { receipts: n(totals[0].receipts), collected: n(totals[0].collected), discount: n(totals[0].discount) },
    data: rows.map((r) => ({
      receipt_no: r.receipt_no, payment_date: r.payment_date, student_name: r.student_name, unique_no: r.unique_no, class: r.class, section: r.section, left_school: !r.is_active,
      payment_mode: r.payment_mode, billing_mode: r.billing_mode, months: r.months, amount_paid: n(r.amount_paid), discount_amount: n(r.discount_amount), pending_amount: n(r.pending_amount),
      reprint_count: r.reprint_count, collected_by: users.find((u) => u.id === r.collected_by)?.name ?? null,
      lines: lines.filter((l) => l.payment_id === r.id).map((l) => ({ head_name: l.head_name, amount: l.amount })),
    })),
    page, limit, total: n(totals[0].receipts), ...options,
  });
}));

/* ---------------- GET /api/fees/summary : totals + class-wise / fee-wise / mode-wise / day-wise ---------------- */
feeReportsRouter.get('/summary', canView, wrap(async (req, res) => {
  const sid = schoolId(req);
  const range = periodOf(req);
  const where = conditions(req, sid, range);
  const off = tzOffsetMin();

  const [tot, byClass, byHead, byMode, byDay, options] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT count(*) AS receipts, count(DISTINCT p.student_id) AS students, COALESCE(sum(p.amount_paid), 0) AS collected, COALESCE(sum(p.discount_amount), 0) AS discount
      FROM "FeePayment" p JOIN "Student" s ON s.id = p.student_id WHERE ${where}`,
    prisma.$queryRaw<any[]>`
      SELECT s.class, count(*) AS receipts, count(DISTINCT p.student_id) AS students, sum(p.amount_paid) AS collected, sum(p.discount_amount) AS discount
      FROM "FeePayment" p JOIN "Student" s ON s.id = p.student_id WHERE ${where} GROUP BY s.class`,
    prisma.$queryRaw<any[]>`
      SELECT l.head_name AS head, sum(l.amount) AS collected
      FROM "FeePaymentLine" l JOIN "FeePayment" p ON p.id = l.payment_id JOIN "Student" s ON s.id = p.student_id
      WHERE ${where} GROUP BY l.head_name ORDER BY collected DESC`,
    prisma.$queryRaw<any[]>`
      SELECT p.payment_mode AS mode, count(*) AS receipts, sum(p.amount_paid) AS collected
      FROM "FeePayment" p JOIN "Student" s ON s.id = p.student_id WHERE ${where} GROUP BY p.payment_mode ORDER BY collected DESC`,
    prisma.$queryRaw<any[]>`
      SELECT (p.payment_date + make_interval(mins => ${off}::int))::date AS day, count(*) AS receipts, sum(p.amount_paid) AS collected
      FROM "FeePayment" p JOIN "Student" s ON s.id = p.student_id WHERE ${where} GROUP BY 1 ORDER BY 1 DESC`,
    filterOptions(req, sid),
  ]);

  res.json({
    range: { period: range.preset, from: range.from, to: range.to },
    scope: req.user!.role === 'FEES_COLLECTOR' ? 'mine' : 'all',
    totals: { receipts: n(tot[0].receipts), students: n(tot[0].students), collected: n(tot[0].collected), discount: n(tot[0].discount) },
    by_class: byClass.map((r) => ({ class: r.class as string, receipts: n(r.receipts), students: n(r.students), collected: n(r.collected), discount: n(r.discount) })).sort((a, b) => classSort(a.class, b.class)),
    by_head: byHead.map((r) => ({ head: r.head as string, collected: n(r.collected) })),
    by_mode: byMode.map((r) => ({ mode: r.mode as string, receipts: n(r.receipts), collected: n(r.collected) })),
    by_day: byDay.map((r) => ({ date: dateStr(new Date(r.day)), receipts: n(r.receipts), collected: n(r.collected) })),
    ...options,
  });
}));
