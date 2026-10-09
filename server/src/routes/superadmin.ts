import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';
import { authenticate, invalidateSchool, requireRole } from '../middleware/auth';
import { HttpError, classSort, wrap } from '../lib/util';
import { MENU_KEYS, cleanMenus } from '../lib/menus';
import { dateStr, localDateOnly, localRangeInstants, parseDateOnly, tzOffsetMin } from '../lib/time';
import { Sheet, workbookBuffer } from '../lib/xlsxOut';
import { Prisma } from '@prisma/client';

export const superAdminRouter = Router();
superAdminRouter.use(authenticate(), requireRole('SUPER_ADMIN'));

/* ---------------- helpers ---------------- */
const PLAN_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
const addMonths = (d: Date, n: number) => {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
  if (r.getUTCDate() !== d.getUTCDate()) r.setUTCDate(0); // 31 Jan + 1 month = 28/29 Feb
  return r;
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** NONE (no end date) | ACTIVE | EXPIRING (30 days or less left) | EXPIRED */
export function planStatus(end: Date | null | undefined) {
  if (!end) return 'NONE';
  const left = Math.round((end.getTime() - localDateOnly().getTime()) / 86400000);
  return left < 0 ? 'EXPIRED' : left <= 30 ? 'EXPIRING' : 'ACTIVE';
}

/** Profile + plan fields from a request body; only fields that were sent are returned (used by create and edit). */
function schoolFields(b: any, partial: boolean) {
  const d: Prisma.SchoolUpdateInput = {};
  const set = (k: 'address' | 'city' | 'state' | 'pincode' | 'mobile' | 'email' | 'contact_person', max: number) => { if (b?.[k] !== undefined) d[k] = text(b[k], max); };
  set('address', 300); set('city', 80); set('state', 80); set('pincode', 12); set('mobile', 20); set('email', 120); set('contact_person', 80);
  if (d.mobile && !/^[0-9+\-\s]{7,20}$/.test(String(d.mobile))) throw new HttpError(400, 'Enter a valid mobile number');
  if (d.email && !/^\S+@\S+\.\S+$/.test(String(d.email))) throw new HttpError(400, 'Enter a valid school email');
  if (b?.name !== undefined) { const n = text(b.name, 120); if (!n) throw new HttpError(400, 'School name required'); d.name = n; }

  if (b?.plan_type !== undefined || partial === false) {
    const t = String(b?.plan_type ?? 'YEARLY').toUpperCase();
    if (!(t in PLAN_MONTHS)) throw new HttpError(400, 'Plan must be MONTHLY, QUARTERLY, HALF_YEARLY or YEARLY');
    d.plan_type = t;
  }
  if (b?.plan_amount !== undefined) {
    const a = Number(b.plan_amount);
    if (!Number.isInteger(a) || a < 0) throw new HttpError(400, 'Plan amount must be a whole number, 0 or more');
    d.plan_amount = a;
  }
  if (b?.plan_start !== undefined) {
    d.plan_start = b.plan_start ? parseDateOnly(String(b.plan_start)) : null;
  }
  if (b?.plan_end !== undefined && b.plan_end !== '') d.plan_end = parseDateOnly(String(b.plan_end));
  else if (b?.plan_end === '') d.plan_end = null;
  // start date + plan type but no end date sent: end = start + plan length
  if (b?.plan_end === undefined && d.plan_start && d.plan_type) d.plan_end = addMonths(d.plan_start as Date, PLAN_MONTHS[d.plan_type as string]);
  if (d.plan_start && d.plan_end && (d.plan_end as Date) < (d.plan_start as Date)) throw new HttpError(400, 'Plan end date is before the start date');
  return d;
}

async function generateSchoolCode(name: string) {
  const prefix = (name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'SCH').padEnd(3, 'X');
  for (let n = (await prisma.school.count({ where: { code: { startsWith: prefix } } })) + 1; n < 10000; n++) {
    const code = `${prefix}${String(n).padStart(3, '0')}`;
    if (!(await prisma.school.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new Error('Could not generate school code');
}

const iso = (d: Date | null) => (d ? dateStr(d) : null);
const shape = (s: any, extra: Record<string, unknown> = {}) => ({
  id: s.id, name: s.name, code: s.code, is_active: s.is_active, createdAt: s.createdAt,
  address: s.address, city: s.city, state: s.state, pincode: s.pincode, mobile: s.mobile, email: s.email, contact_person: s.contact_person,
  plan_type: s.plan_type, plan_amount: s.plan_amount, plan_start: iso(s.plan_start), plan_end: iso(s.plan_end), plan_status: planStatus(s.plan_end),
  disabled_menus: cleanMenus(s.disabled_menus), ...extra,
});

/* ---------------- create / list / view / edit ---------------- */

superAdminRouter.post('/create-school', wrap(async (req, res) => {
  const { schoolName, adminEmail, adminPassword } = req.body ?? {};
  if (!schoolName || !adminEmail || !adminPassword || String(adminPassword).length < 6)
    return res.status(400).json({ error: 'schoolName, adminEmail and adminPassword (min 6 chars) required' });

  const email = String(adminEmail).toLowerCase().trim();
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } }))
    return res.status(409).json({ error: 'Admin email already exists' });

  const fields = schoolFields({ ...req.body, name: schoolName, plan_start: req.body?.plan_start || dateStr(localDateOnly()) }, false);
  const code = await generateSchoolCode(String(schoolName));
  const password = await bcrypt.hash(String(adminPassword), 10);

  const result = await prisma.$transaction(async (tx) => {
    const school = await tx.school.create({ data: { ...(fields as Prisma.SchoolCreateInput), name: String(schoolName).trim(), code } });
    const admin = await tx.user.create({
      data: { name: `${school.name} Admin`, email, password, role: 'SCHOOL_ADMIN', school_id: school.id },
      select: { id: true, email: true, role: true },
    });
    return { school, admin };
  });
  res.status(201).json({ school: shape(result.school), admin: result.admin });
}));

/* GET /api/superadmin/schools?search=&status=active|inactive&plan_type=&plan_status=&state=&city=&sort=&dir=&page=&limit= */
const SCHOOL_SORTS: Record<string, (a: any, b: any) => number> = {
  name: (a, b) => a.name.localeCompare(b.name), code: (a, b) => a.code.localeCompare(b.code), city: (a, b) => a.city.localeCompare(b.city),
  created: (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt), students: (a, b) => a.students - b.students,
  plan: (a, b) => a.plan_type.localeCompare(b.plan_type), plan_end: (a, b) => (a.plan_end ?? '').localeCompare(b.plan_end ?? ''),
  amount: (a, b) => a.plan_amount - b.plan_amount, status: (a, b) => Number(a.is_active) - Number(b.is_active),
};

async function listSchools(q: Record<string, any>) {
  const [schools, counts, admins] = await Promise.all([
    prisma.school.findMany({ orderBy: { createdAt: 'desc' }, take: 5000 }),
    prisma.student.groupBy({ by: ['school_id', 'is_active'], _count: { _all: true } }),
    prisma.user.findMany({ where: { role: 'SCHOOL_ADMIN' }, select: { school_id: true, email: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  const active = new Map<string, number>(), left = new Map<string, number>();
  for (const c of counts) (c.is_active ? active : left).set(c.school_id, c._count._all);
  const adminOf = new Map<string, string>();
  for (const a of admins) if (a.school_id && !adminOf.has(a.school_id)) adminOf.set(a.school_id, a.email);

  const search = text(q.search, 80).toLowerCase();
  const wantStatus = text(q.status, 10), wantPlan = text(q.plan_type, 20).toUpperCase(), wantPs = text(q.plan_status, 10).toUpperCase();
  const state = text(q.state, 80).toLowerCase(), city = text(q.city, 80).toLowerCase();
  let rows = schools.map((s) => shape(s, { students: active.get(s.id) ?? 0, students_left: left.get(s.id) ?? 0, admin_email: adminOf.get(s.id) ?? '' }));
  rows = rows.filter((r) =>
    (!search || [r.name, r.code, r.city, r.mobile, r.email, r.admin_email, r.contact_person].some((x) => String(x).toLowerCase().includes(search))) &&
    (!wantStatus || (wantStatus === 'active' ? r.is_active : !r.is_active)) &&
    (!wantPlan || r.plan_type === wantPlan) && (!wantPs || r.plan_status === wantPs) &&
    (!state || r.state.toLowerCase() === state) && (!city || r.city.toLowerCase() === city));
  const cmp = SCHOOL_SORTS[String(q.sort ?? 'created')] ?? SCHOOL_SORTS.created;
  const dir = String(q.dir ?? 'desc') === 'asc' ? 1 : -1;
  rows.sort((a, b) => dir * cmp(a, b));
  return { rows, states: [...new Set(schools.map((s) => s.state).filter(Boolean))].sort(), cities: [...new Set(schools.map((s) => s.city).filter(Boolean))].sort() };
}

superAdminRouter.get('/schools', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '25'), 10) || 25));
  const { rows, states, cities } = await listSchools(req.query);
  res.json({ data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit, states, cities });
}));

superAdminRouter.get('/schools/:id', wrap(async (req, res) => {
  const s = await prisma.school.findUnique({ where: { id: req.params.id } });
  if (!s) return res.status(404).json({ error: 'School not found' });
  const [admins, active, left, users] = await Promise.all([
    prisma.user.findMany({ where: { school_id: s.id, role: 'SCHOOL_ADMIN' }, select: { id: true, name: true, email: true } }),
    prisma.student.count({ where: { school_id: s.id, is_active: true } }),
    prisma.student.count({ where: { school_id: s.id, is_active: false } }),
    prisma.user.groupBy({ by: ['role'], where: { school_id: s.id }, _count: { _all: true } }),
  ]);
  res.json({
    school: shape(s, { students: active, students_left: left, admins, users: users.map((u) => ({ role: u.role, count: u._count._all })), fee_due_day: s.fee_due_day, late_fee_amount: s.late_fee_amount }),
    menu_keys: MENU_KEYS,
  });
}));

superAdminRouter.patch('/schools/:id', wrap(async (req, res) => {
  const exists = await prisma.school.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'School not found' });
  const data = schoolFields(req.body, true);
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' });
  const s = await prisma.school.update({ where: { id: req.params.id }, data });
  res.json(shape(s));
}));

/* Menus switched off for one school. Only hides navigation; no API is blocked, no data is touched. */
superAdminRouter.put('/schools/:id/menus', wrap(async (req, res) => {
  const disabled = cleanMenus(req.body?.disabled);
  const r = await prisma.school.updateMany({ where: { id: req.params.id }, data: { disabled_menus: disabled } });
  if (!r.count) return res.status(404).json({ error: 'School not found' });
  res.json({ ok: true, disabled });
}));

superAdminRouter.patch('/schools/:id/toggle', wrap(async (req, res) => {
  const school = await prisma.school.findUnique({ where: { id: req.params.id } });
  if (!school) return res.status(404).json({ error: 'School not found' });
  const updated = await prisma.school.update({ where: { id: school.id }, data: { is_active: !school.is_active } });
  invalidateSchool(school.id);
  res.json(updated);
}));

superAdminRouter.post('/schools/:id/admin-password', wrap(async (req, res) => {
  const pw = String(req.body?.password ?? '');
  if (pw.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const r = await prisma.user.updateMany({ where: { school_id: req.params.id, role: 'SCHOOL_ADMIN' }, data: { password: await bcrypt.hash(pw, 10) } });
  if (!r.count) return res.status(404).json({ error: 'School admin not found' });
  res.json({ ok: true });
}));

/* ---------------- analytics ---------------- */

const FY_START = (today: Date) => new Date(Date.UTC(today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 3, 1));
/** today | yesterday | week | month | last30 | fy | custom -> inclusive local days */
function rangeOf(q: Record<string, any>) {
  const today = localDateOnly();
  const p = String(q.period ?? 'month');
  let from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), to = today;
  if (p === 'today') from = today;
  else if (p === 'yesterday') from = to = addDays(today, -1);
  else if (p === 'week') from = addDays(today, -((today.getUTCDay() + 6) % 7));
  else if (p === 'last30') from = addDays(today, -29);
  else if (p === 'fy') from = FY_START(today);
  else if (p === 'custom') {
    try { from = parseDateOnly(String(q.from ?? '')); to = parseDateOnly(String(q.to ?? '')); } catch { throw new HttpError(400, 'Pick a valid from and to date'); }
    if (from > to) throw new HttpError(400, 'From date is after To date');
    if ((to.getTime() - from.getTime()) / 86400000 > 731) throw new HttpError(400, 'Choose a range of at most two years');
  } else if (p !== 'month') throw new HttpError(400, 'Unknown period');
  return { period: p, from, to, ...localRangeInstants(from, to) };
}
const n = (v: unknown) => Number(v ?? 0);

/** One row per school with its numbers for the period. */
async function schoolMetrics(q: Record<string, any>) {
  const r = rangeOf(q);
  const { rows, states, cities } = await listSchools(q);
  const ids = rows.map((x) => x.id);
  const none = !ids.length;
  const [fp, at, last] = none ? [[], [], []] : await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT school_id, COALESCE(sum(amount_paid),0) AS collected, count(*) AS receipts, count(DISTINCT student_id) AS payers, COALESCE(sum(discount_amount),0) AS discount
      FROM "FeePayment" WHERE school_id = ANY(${ids}) AND payment_date >= ${r.start} AND payment_date < ${r.end} GROUP BY school_id`,
    prisma.$queryRaw<any[]>`
      SELECT school_id, count(*) FILTER (WHERE status IN ('PRESENT','LATE')) AS present, count(*) FILTER (WHERE status = 'LATE') AS late, count(DISTINCT date) AS days_open
      FROM "Attendance" WHERE school_id = ANY(${ids}) AND date >= ${dateStr(r.from)}::date AND date <= ${dateStr(r.to)}::date GROUP BY school_id`,
    prisma.$queryRaw<any[]>`
      SELECT school_id, max(payment_date) AS last_payment FROM "FeePayment" WHERE school_id = ANY(${ids}) GROUP BY school_id`,
  ]);
  const fpM = new Map(fp.map((x) => [x.school_id, x])), atM = new Map(at.map((x) => [x.school_id, x])), lastM = new Map(last.map((x) => [x.school_id, x]));
  const data = rows.map((s) => {
    const f = fpM.get(s.id), a = atM.get(s.id);
    const present = n(a?.present), daysOpen = n(a?.days_open);
    const denom = s.students * daysOpen;
    return {
      ...s, collected: n(f?.collected), receipts: n(f?.receipts), payers: n(f?.payers), discount: n(f?.discount),
      avg_per_student: s.students ? Math.round(n(f?.collected) / s.students) : 0,
      present_marks: present, late_marks: n(a?.late), days_open: daysOpen, attendance_pct: denom ? Math.round((present / denom) * 1000) / 10 : 0,
      last_payment: lastM.get(s.id)?.last_payment ?? null,
    };
  });
  return { range: r, data, ids, states, cities };
}

const METRIC_SORTS: Record<string, (a: any, b: any) => number> = {
  ...SCHOOL_SORTS,
  collected: (a, b) => a.collected - b.collected, receipts: (a, b) => a.receipts - b.receipts, payers: (a, b) => a.payers - b.payers,
  attendance: (a, b) => a.attendance_pct - b.attendance_pct, avg: (a, b) => a.avg_per_student - b.avg_per_student,
  last_payment: (a, b) => String(a.last_payment ?? '').localeCompare(String(b.last_payment ?? '')),
};

/* GET /api/superadmin/analytics?period=month&from=&to=&search=&status=&plan_type=&plan_status=&state=&city=&sort=collected&dir=desc&group=none|state|city|plan_type|plan_status */
superAdminRouter.get('/analytics', wrap(async (req, res) => {
  const { range, data, ids, states, cities } = await schoolMetrics(req.query);
  const cmp = METRIC_SORTS[String(req.query.sort ?? 'collected')] ?? METRIC_SORTS.collected;
  const dir = String(req.query.dir ?? 'desc') === 'asc' ? 1 : -1;
  data.sort((a, b) => dir * cmp(a, b));

  const sum = (f: (x: any) => number) => data.reduce((t, x) => t + f(x), 0);
  const students = sum((x) => x.students), daysOpenDenom = sum((x) => x.students * x.days_open);
  const planMonthly = (x: any) => (x.plan_status === 'EXPIRED' || !x.is_active ? 0 : x.plan_amount / PLAN_MONTHS[x.plan_type]);
  const totals = {
    schools: data.length, active_schools: data.filter((x) => x.is_active).length,
    students, students_left: sum((x) => x.students_left), collected: sum((x) => x.collected), receipts: sum((x) => x.receipts), discount: sum((x) => x.discount),
    attendance_pct: daysOpenDenom ? Math.round((sum((x) => x.present_marks) / daysOpenDenom) * 1000) / 10 : 0,
    plan_revenue_monthly: Math.round(sum(planMonthly)), plan_revenue_yearly: Math.round(sum(planMonthly) * 12),
    expiring: data.filter((x) => x.plan_status === 'EXPIRING').length, expired: data.filter((x) => x.plan_status === 'EXPIRED').length,
    inactive_schools: data.filter((x) => !x.is_active).length,
  };

  // grouping (state / city / plan ...)
  const group = String(req.query.group ?? 'none');
  const groups: any[] = [];
  if (['state', 'city', 'plan_type', 'plan_status'].includes(group)) {
    const m = new Map<string, any>();
    for (const x of data) {
      const k = String((x as any)[group] || '(not set)');
      const g = m.get(k) ?? { key: k, schools: 0, students: 0, collected: 0, receipts: 0, present: 0, denom: 0 };
      g.schools++; g.students += x.students; g.collected += x.collected; g.receipts += x.receipts; g.present += x.present_marks; g.denom += x.students * x.days_open;
      m.set(k, g);
    }
    for (const g of m.values()) groups.push({ key: g.key, schools: g.schools, students: g.students, collected: g.collected, receipts: g.receipts, attendance_pct: g.denom ? Math.round((g.present / g.denom) * 1000) / 10 : 0 });
    groups.sort((a, b) => b.collected - a.collected);
  }

  // trends for the chosen schools
  const off = tzOffsetMin();
  const [byDay, attDay, newSchools] = ids.length ? await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT (payment_date + make_interval(mins => ${off}::int))::date AS day, sum(amount_paid) AS collected, count(*) AS receipts
      FROM "FeePayment" WHERE school_id = ANY(${ids}) AND payment_date >= ${range.start} AND payment_date < ${range.end} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<any[]>`
      SELECT date AS day, count(*) FILTER (WHERE status IN ('PRESENT','LATE')) AS present
      FROM "Attendance" WHERE school_id = ANY(${ids}) AND date >= ${dateStr(range.from)}::date AND date <= ${dateStr(range.to)}::date GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<any[]>`
      SELECT to_char(("createdAt" + make_interval(mins => ${off}::int)), 'YYYY-MM') AS month, count(*) AS schools
      FROM "School" WHERE id = ANY(${ids}) GROUP BY 1 ORDER BY 1`,
  ]) : [[], [], []];

  res.json({
    range: { period: range.period, from: dateStr(range.from), to: dateStr(range.to) },
    totals, groups, schools: data, states, cities,
    series: {
      collection_by_day: byDay.map((r) => ({ date: dateStr(new Date(r.day)), collected: n(r.collected), receipts: n(r.receipts) })),
      attendance_by_day: attDay.map((r) => ({ date: dateStr(new Date(r.day)), present: n(r.present) })),
      schools_by_month: newSchools.map((r) => ({ month: r.month as string, schools: n(r.schools) })),
    },
  });
}));

superAdminRouter.get('/analytics.xlsx', wrap(async (req, res) => {
  const { range, data } = await schoolMetrics(req.query);
  const sheet: Sheet = {
    name: 'Schools',
    columns: ['School', 'Code', 'City', 'State', 'Mobile', 'Status', 'Plan', 'Plan amount', 'Plan end', 'Plan status', 'Students', 'Left school', 'Collected', 'Receipts', 'Students who paid', 'Discount', 'Attendance %', 'School days open', 'Last payment']
      .map((header, i) => ({ header, key: `c${i}` })),
    rows: data.map((x) => ({
      c0: x.name, c1: x.code, c2: x.city, c3: x.state, c4: x.mobile, c5: x.is_active ? 'Active' : 'Inactive', c6: x.plan_type, c7: x.plan_amount, c8: x.plan_end ?? '', c9: x.plan_status,
      c10: x.students, c11: x.students_left, c12: x.collected, c13: x.receipts, c14: x.payers, c15: x.discount, c16: x.attendance_pct, c17: x.days_open, c18: x.last_payment ?? '',
    })),
  };
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="School_Analytics_${dateStr(range.from)}_to_${dateStr(range.to)}.xlsx"` });
  res.send(await workbookBuffer([sheet]));
}));

/* One school in detail: students by class, collection by month / mode / head, attendance trend */
superAdminRouter.get('/schools/:id/analytics', wrap(async (req, res) => {
  const sid = req.params.id;
  if (!(await prisma.school.findUnique({ where: { id: sid }, select: { id: true } }))) return res.status(404).json({ error: 'School not found' });
  const r = rangeOf({ period: 'last30', ...req.query });
  const off = tzOffsetMin();
  const today = localDateOnly();
  const yearAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  const yStart = new Date(yearAgo.getTime() - off * 60000);
  const [classes, month, mode, head, att, tot, todayAtt] = await Promise.all([
    prisma.student.groupBy({ by: ['class', 'is_active'], where: { school_id: sid }, _count: { _all: true } }),
    prisma.$queryRaw<any[]>`
      SELECT to_char((payment_date + make_interval(mins => ${off}::int)), 'YYYY-MM') AS month, sum(amount_paid) AS collected, count(*) AS receipts
      FROM "FeePayment" WHERE school_id = ${sid} AND payment_date >= ${yStart} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<any[]>`
      SELECT payment_mode AS mode, sum(amount_paid) AS collected, count(*) AS receipts FROM "FeePayment"
      WHERE school_id = ${sid} AND payment_date >= ${r.start} AND payment_date < ${r.end} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<any[]>`
      SELECT l.head_name AS head, sum(l.amount) AS collected FROM "FeePaymentLine" l JOIN "FeePayment" p ON p.id = l.payment_id
      WHERE p.school_id = ${sid} AND p.payment_date >= ${r.start} AND p.payment_date < ${r.end} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<any[]>`
      SELECT date AS day, count(*) FILTER (WHERE status IN ('PRESENT','LATE')) AS present, count(*) FILTER (WHERE status = 'LATE') AS late
      FROM "Attendance" WHERE school_id = ${sid} AND date >= ${dateStr(r.from)}::date AND date <= ${dateStr(r.to)}::date GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<any[]>`
      SELECT COALESCE(sum(amount_paid),0) AS collected, count(*) AS receipts, count(DISTINCT student_id) AS payers FROM "FeePayment"
      WHERE school_id = ${sid} AND payment_date >= ${r.start} AND payment_date < ${r.end}`,
    prisma.attendance.count({ where: { school_id: sid, date: today, status: { in: ['PRESENT', 'LATE'] } } }),
  ]);
  const byClass = new Map<string, { class: string; active: number; left: number }>();
  for (const c of classes) { const e = byClass.get(c.class) ?? { class: c.class, active: 0, left: 0 }; if (c.is_active) e.active += c._count._all; else e.left += c._count._all; byClass.set(c.class, e); }
  res.json({
    range: { period: r.period, from: dateStr(r.from), to: dateStr(r.to) },
    totals: { collected: n(tot[0].collected), receipts: n(tot[0].receipts), payers: n(tot[0].payers), present_today: todayAtt },
    students_by_class: [...byClass.values()].sort((a, b) => classSort(a.class, b.class)),
    by_month: month.map((x) => ({ month: x.month as string, collected: n(x.collected), receipts: n(x.receipts) })),
    by_mode: mode.map((x) => ({ mode: x.mode as string, collected: n(x.collected), receipts: n(x.receipts) })),
    by_head: head.map((x) => ({ head: x.head as string, collected: n(x.collected) })),
    attendance_by_day: att.map((x) => ({ date: dateStr(new Date(x.day)), present: n(x.present), late: n(x.late) })),
  });
}));
