import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { enqueue } from '../lib/jobQueue';
import { loadLedger, parseFeeSpec, resolveMonths, MapRow } from '../lib/fees';
import { buildReceipt } from '../lib/receipt';
import { currentFy, fyLabel, localDateOnly, parseDateOnly } from '../lib/time';
import { HttpError, schoolId, wrap } from '../lib/util';

export const feesRouter = Router();
feesRouter.use(authenticate());

const canCollect = requireRole('SCHOOL_ADMIN', 'FEES_COLLECTOR');
const adminOnly = requireRole('SCHOOL_ADMIN');
const LEFT_MSG = 'This student has left the school. Fees cannot be collected.';
const noFee = (cls: string) => `No fee is set for Class ${cls}. Add a fee structure first.`;
const isInt = (n: number) => Number.isInteger(n) && n >= 0;
const dupToConflict = (msg: string) => (e: unknown) => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new HttpError(409, msg);
  throw e;
};
const fyParam = (req: { query: Record<string, unknown> }) => {
  const n = parseInt(String(req.query.fy ?? ''), 10);
  return n >= 2000 && n <= 2100 ? n : currentFy();
};

const studentSelect = { id: true, name: true, class: true, section: true, photo_url: true, unique_no: true, uses_transport: true, admission_date: true, parent_phone: true, is_active: true } as const;

/* ============================ COLLECT ============================ */

/* GET /api/fees/search?query=STU-0001  (unique_no | rfid_uid | parent_phone) */
feesRouter.get('/search', canCollect, wrap(async (req, res) => {
  const sid = schoolId(req);
  const q = String(req.query.query ?? '').trim();
  if (!q) return res.status(400).json({ error: 'query required' });

  const student = await prisma.student.findFirst({
    where: { school_id: sid, OR: [{ unique_no: q.toUpperCase() }, { unique_no: q }, { rfid_uid: q }, { parent_phone: q }] },
    select: studentSelect,
  });
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const fy = fyParam(req);
  const [ledger, payments] = await Promise.all([
    loadLedger(prisma, sid, student, fy),
    prisma.feePayment.findMany({
      where: { school_id: sid, student_id: student.id }, orderBy: { payment_date: 'desc' }, take: 50,
      select: { id: true, receipt_no: true, fy: true, billing_mode: true, months: true, amount_paid: true, discount_amount: true, pending_amount: true, payment_mode: true, payment_date: true },
    }),
  ]);
  const lines = payments.length
    ? await prisma.feePaymentLine.findMany({ where: { school_id: sid, payment_id: { in: payments.map((p) => p.id) } }, select: { payment_id: true, head_name: true, amount: true, month_idx: true } })
    : [];

  const missing = !ledger.class_has_structure;
  res.json({
    student: {
      name: student.name, class: student.class, section: student.section, photo: student.photo_url, unique_no: student.unique_no,
      uses_transport: student.uses_transport, is_active: student.is_active,
    },
    inactive: !student.is_active,
    fy: { start: fy, label: fyLabel(fy), billed_months: ledger.billed_months, billing_from: ledger.billing_from },
    heads: ledger.heads,
    applied_discounts: ledger.discounts.map((d) => ({ name: d.name, type: d.type, value: d.value })),
    total_fee: ledger.totals.gross - ledger.totals.admin_discount,
    admin_discount: ledger.totals.admin_discount, other_discount: ledger.totals.other_discount,
    total_paid: ledger.totals.paid, fees_left: ledger.totals.left, late: ledger.late,
    fee_structure_missing: missing,
    message: !student.is_active ? LEFT_MSG : missing ? noFee(student.class) : ledger.heads.length === 0 ? `No fee head applies to this student in Class ${student.class}.` : ledger.billed_months === 0 ? 'Billing for this student starts in the next financial year.' : null,
    payment_history: payments.map((p) => ({ ...p, lines: lines.filter((l) => l.payment_id === p.id).map((l) => ({ head_name: l.head_name, amount: l.amount, month_idx: l.month_idx })) })),
  });
}));

/*
 POST /api/fees/collect
 { unique_no, payment_mode, billing_mode: MONTHLY|QUARTERLY|HALF_YEARLY|YEARLY, months: [fee month numbers 0 = Apr ... 11 = Mar], discount_reason,
   lines: [{ head_id (or "__LATE__" for the late fee), amount, other_discount }] }
 The amount of every head is shared over the chosen months, oldest first, and saved against each month.
*/
feesRouter.post('/collect', canCollect, wrap(async (req, res) => {
  const sid = schoolId(req);
  const { unique_no } = req.body ?? {};
  const mode = String(req.body?.payment_mode ?? '').toUpperCase();
  const billing_mode = String(req.body?.billing_mode ?? 'MONTHLY').toUpperCase();
  const reason = String(req.body?.discount_reason ?? '').trim().slice(0, 200);
  const rawMonths: number[] = (Array.isArray(req.body?.months) ? req.body.months : []).map((x: unknown) => Number(x));
  const chosen = [...new Set(rawMonths)].filter((m) => Number.isInteger(m) && m >= 0 && m <= 11).sort((a, b) => a - b);
  const lines = (Array.isArray(req.body?.lines) ? req.body.lines : [])
    .map((l: any) => ({ head_id: String(l?.head_id ?? ''), amount: Number(l?.amount ?? 0), disc: Number(l?.other_discount ?? 0) }))
    .filter((l: { amount: number; disc: number }) => l.amount > 0 || l.disc > 0);

  if (!unique_no || !['CASH', 'UPI', 'CARD', 'CHEQUE'].includes(mode)) return res.status(400).json({ error: 'unique_no and payment_mode (CASH|UPI|CARD|CHEQUE) required' });
  if (!['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'].includes(billing_mode)) return res.status(400).json({ error: 'billing_mode must be MONTHLY, QUARTERLY, HALF_YEARLY or YEARLY' });
  if (!chosen.length) return res.status(400).json({ error: 'Select the fee month to pay for' });
  if (!lines.length || !lines.every((l: any) => l.head_id && isInt(l.amount) && isInt(l.disc))) return res.status(400).json({ error: 'Enter whole-number amounts for at least one fee head' });
  const totalPay: number = lines.reduce((a: number, l: any) => a + l.amount, 0);
  const totalDisc: number = lines.reduce((a: number, l: any) => a + l.disc, 0);
  if (totalPay <= 0) return res.status(400).json({ error: 'Amount to collect must be more than 0' });
  if (totalDisc > 0 && !reason) return res.status(400).json({ error: 'Give a reason for the discount' });
  if (new Set(lines.map((l: any) => l.head_id)).size !== lines.length) return res.status(400).json({ error: 'Duplicate fee head in request' });

  const student = await prisma.student.findFirst({ where: { school_id: sid, unique_no: String(unique_no) }, select: studentSelect });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  if (!student.is_active) return res.status(400).json({ error: LEFT_MSG });

  const fy = currentFy();
  const user = req.user!;

  const result = await prisma.$transaction(async (tx) => {
    // serialize concurrent collections for the same student (two cashiers / double click)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${student.id}))`;
    const ledger = await loadLedger(tx, sid, student, fy);
    if (!ledger.class_has_structure) throw new HttpError(400, noFee(student.class));

    // split each head's amount (and discount) over the chosen months, oldest month first
    const parts: { head_id: string; name: string; month: number; amount: number; disc: number }[] = [];
    for (const l of lines as { head_id: string; amount: number; disc: number }[]) {
      const h = ledger.heads.find((x) => x.head_id === l.head_id);
      if (!h) throw new HttpError(400, 'A selected fee head does not apply to this student');
      const room = chosen.reduce((t, m) => t + h.months[m].left, 0);
      if (l.amount + l.disc > room) throw new HttpError(400, `${h.name}: amount plus discount is more than what is due for the selected month${chosen.length > 1 ? 's' : ''} (Rs ${room})`);
      let pay = l.amount, disc = l.disc;
      for (const m of chosen) {
        let left = h.months[m].left;
        const d = Math.min(left, disc); disc -= d; left -= d;
        const p = Math.min(left, pay); pay -= p;
        if (p > 0 || d > 0) parts.push({ head_id: h.head_id, name: h.name, month: m, amount: p, disc: d });
      }
    }

    const payment = await tx.feePayment.create({
      data: {
        school_id: sid, student_id: student.id, fy, amount_paid: totalPay, discount_amount: totalDisc,
        pending_amount: ledger.totals.left - totalPay - totalDisc, payment_mode: mode, billing_mode, months: chosen.length,
        collected_by: user.id, receipt_no: `RCPT-${Date.now()}`,
      },
    });
    const paidParts = parts.filter((p) => p.amount > 0);
    await tx.feePaymentLine.createMany({ data: paidParts.map((p) => ({ school_id: sid, payment_id: payment.id, student_id: student.id, fy, head_id: p.head_id, head_name: p.name, amount: p.amount, month_idx: p.month })) });
    const discParts = parts.filter((p) => p.disc > 0);
    if (discParts.length)
      await tx.discountEntry.createMany({ data: discParts.map((p) => ({ school_id: sid, student_id: student.id, fy, head_id: p.head_id, month_idx: p.month, kind: 'OTHER', amount: p.disc, reason, given_by: user.id, given_by_name: user.name, payment_id: payment.id })) });
    return { payment, paidParts };
  }).catch(dupToConflict('Duplicate receipt number, please retry'));

  const { payment, paidParts } = result;
  const feeNames = [...new Set(paidParts.map((l) => l.name))].join(', ');
  await enqueue('RECEIPT', {
    phone: student.parent_phone, receipt_no: payment.receipt_no, amount_paid: payment.amount_paid, fee_type: feeNames,
    payment_mode: mode, student_name: student.name,
  }, sid);

  res.status(201).json({ receipt: await buildReceipt(sid, payment.id) });
}));

/* GET /api/fees/receipts/:receipt_no  -> reprint (marked as duplicate, and counted) */
feesRouter.get('/receipts/:receipt_no', canCollect, wrap(async (req, res) => {
  const sid = schoolId(req);
  const p = await prisma.feePayment.findFirst({ where: { school_id: sid, receipt_no: req.params.receipt_no }, select: { id: true } });
  if (!p) return res.status(404).json({ error: 'Receipt not found' });
  await prisma.feePayment.update({ where: { id: p.id }, data: { reprint_count: { increment: 1 } } });
  res.json({ receipt: { ...(await buildReceipt(sid, p.id)), duplicate: true } });
}));

/* ============================ FEE HEADS ============================ */

feesRouter.get('/heads', canCollect, wrap(async (req, res) => {
  const data = await prisma.feeHead.findMany({ where: { school_id: schoolId(req) }, orderBy: { createdAt: 'asc' } });
  res.json({ data });
}));

feesRouter.post('/heads', adminOnly, wrap(async (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Fee head name required' });
  const head = await prisma.feeHead.create({ data: { school_id: schoolId(req), name, transport_only: !!req.body?.transport_only } })
    .catch(dupToConflict('A fee head with this name already exists'));
  res.status(201).json(head);
}));

feesRouter.patch('/heads/:id', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const data: Prisma.FeeHeadUpdateManyMutationInput = {};
  if (req.body?.name !== undefined) { const n = String(req.body.name).trim().slice(0, 60); if (!n) return res.status(400).json({ error: 'Name cannot be empty' }); data.name = n; }
  if (req.body?.transport_only !== undefined) data.transport_only = !!req.body.transport_only;
  if (req.body?.is_active !== undefined) data.is_active = !!req.body.is_active; // heads are never deleted so old receipts keep their names
  const r = await prisma.feeHead.updateMany({ where: { id: req.params.id, school_id: sid }, data }).catch(dupToConflict('A fee head with this name already exists'));
  if (!r.count) return res.status(404).json({ error: 'Fee head not found' });
  res.json({ ok: true });
}));

/* ============================ FEE STRUCTURE (per class) ============================ */

feesRouter.get('/structure', canCollect, wrap(async (req, res) => {
  const sid = schoolId(req);
  const [heads, items] = await Promise.all([
    prisma.feeHead.findMany({ where: { school_id: sid, is_active: true }, orderBy: { createdAt: 'asc' } }),
    prisma.classFee.findMany({ where: { school_id: sid }, select: { class: true, head_id: true, amount: true, period: true, installments: true } }),
  ]);
  res.json({ heads, items });
}));

/* PUT /api/fees/structure/:class  { items: [{ head_id, period, amount | installments }] }  (nothing to charge = removes the head from the class) */
feesRouter.put('/structure/:class', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const cls = String(req.params.class).trim();
  const raw: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!cls || !raw.length) return res.status(400).json({ error: 'class and items required' });
  const items = raw.map((i) => ({ head_id: String(i?.head_id ?? ''), ...parseFeeSpec(i) }));
  if (!items.every((i) => i.head_id)) return res.status(400).json({ error: 'head_id required' });
  if (!items.some((i) => i.amount > 0)) return res.status(400).json({ error: 'Set at least one fee amount above 0' });

  const valid = await prisma.feeHead.findMany({ where: { school_id: sid, id: { in: items.map((i) => i.head_id) } }, select: { id: true } });
  if (valid.length !== new Set(items.map((i) => i.head_id)).size) return res.status(400).json({ error: 'Unknown fee head' });

  await prisma.$transaction(items.map((i) => i.amount > 0
    ? prisma.classFee.upsert({
        where: { school_id_class_head_id: { school_id: sid, class: cls, head_id: i.head_id } },
        update: { amount: i.amount, period: i.period, installments: i.installments ?? Prisma.DbNull },
        create: { school_id: sid, class: cls, head_id: i.head_id, amount: i.amount, period: i.period, installments: i.installments ?? Prisma.DbNull },
      })
    : prisma.classFee.deleteMany({ where: { school_id: sid, class: cls, head_id: i.head_id } })));
  res.json({ ok: true });
}));

/* ============================ CUSTOM FEES FOR ONE STUDENT (admin) ============================ */

/* GET /api/fees/custom/student?unique_no=  -> every active head: class fee next to this student's special fee */
feesRouter.get('/custom/student', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const q = String(req.query.unique_no ?? '').trim();
  const student = await prisma.student.findFirst({ where: { school_id: sid, OR: [{ unique_no: q.toUpperCase() }, { unique_no: q }] }, select: { id: true, name: true, class: true, section: true, unique_no: true, uses_transport: true, is_active: true } });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const [heads, classItems, custom] = await Promise.all([
    prisma.feeHead.findMany({ where: { school_id: sid, is_active: true }, orderBy: { createdAt: 'asc' } }),
    prisma.classFee.findMany({ where: { school_id: sid, class: student.class } }),
    prisma.studentFee.findMany({ where: { school_id: sid, student_id: student.id } }),
  ]);
  res.json({
    student,
    heads: heads.map((h) => {
      const ci = classItems.find((c) => c.head_id === h.id); const cu = custom.find((c) => c.head_id === h.id);
      return {
        head_id: h.id, name: h.name, transport_only: h.transport_only,
        class_amount: ci?.amount ?? null, class_period: ci?.period ?? null, class_installments: ci?.installments ?? null,
        custom_amount: cu?.amount ?? null, custom_period: cu?.period ?? ci?.period ?? 'MONTHLY', custom_installments: cu?.installments ?? ci?.installments ?? null,
      };
    }),
    note: custom[0]?.note ?? '', set_by: custom[0]?.set_by ?? null,
  });
}));

/* PUT /api/fees/custom/student/:unique_no  { note, items: [{ head_id, amount: number | null, period }] }  (null = back to class fee, 0 = exempt) */
feesRouter.put('/custom/student/:unique_no', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const student = await prisma.student.findFirst({ where: { school_id: sid, unique_no: req.params.unique_no }, select: { id: true } });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const note = String(req.body?.note ?? '').trim().slice(0, 200);
  const raw: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
  // amount empty/null = back to the class fee; 0 = exempt; CUSTOM = list of instalments
  const items = raw.map((i) => {
    const head_id = String(i?.head_id ?? '');
    const empty = String(i?.period ?? '').toUpperCase() === 'CUSTOM' ? !(Array.isArray(i?.installments) && i.installments.length) : i?.amount === null || i?.amount === '' || i?.amount === undefined;
    return { head_id, spec: empty ? null : parseFeeSpec(i) };
  });
  if (!items.length || !items.every((i) => i.head_id)) return res.status(400).json({ error: 'Each amount must be a whole number (0 or more), or empty to use the class fee' });
  if (items.some((i) => i.spec) && !note) return res.status(400).json({ error: 'Give a reason for the custom fee' });
  const valid = await prisma.feeHead.count({ where: { school_id: sid, id: { in: items.map((i) => i.head_id) } } });
  if (valid !== new Set(items.map((i) => i.head_id)).size) return res.status(400).json({ error: 'Unknown fee head' });

  const by = req.user!.name;
  await prisma.$transaction(items.map((i) => i.spec === null
    ? prisma.studentFee.deleteMany({ where: { school_id: sid, student_id: student.id, head_id: i.head_id } })
    : prisma.studentFee.upsert({
        where: { student_id_head_id: { student_id: student.id, head_id: i.head_id } },
        update: { amount: i.spec.amount, period: i.spec.period, installments: i.spec.installments ?? Prisma.DbNull, note, set_by: by },
        create: { school_id: sid, student_id: student.id, head_id: i.head_id, amount: i.spec.amount, period: i.spec.period, installments: i.spec.installments ?? Prisma.DbNull, note, set_by: by },
      })));
  res.json({ ok: true });
}));

/* GET /api/fees/custom/list -> every student that has a special fee */
feesRouter.get('/custom/list', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const rows = await prisma.studentFee.findMany({ where: { school_id: sid }, orderBy: { updatedAt: 'desc' }, take: 300 });
  const [students, heads] = await Promise.all([
    rows.length ? prisma.student.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.student_id))] }, school_id: sid }, select: { id: true, name: true, class: true, unique_no: true, is_active: true } }) : [],
    prisma.feeHead.findMany({ where: { school_id: sid }, select: { id: true, name: true } }),
  ]);
  res.json({
    data: rows.map((r) => {
      const s = students.find((x) => x.id === r.student_id);
      return { id: r.id, student: s?.name ?? '?', unique_no: s?.unique_no ?? '?', class: s?.class ?? '', is_active: s?.is_active ?? true, head: heads.find((h) => h.id === r.head_id)?.name ?? '?', amount: r.amount, period: r.period, installments: r.installments, note: r.note, set_by: r.set_by, date: r.updatedAt };
    }),
  });
}));

/* ============================ DISCOUNTS (admin) ============================ */

feesRouter.get('/discounts', adminOnly, wrap(async (req, res) => {
  const data = await prisma.discount.findMany({ where: { school_id: schoolId(req) }, orderBy: { createdAt: 'asc' } });
  res.json({ data });
}));

feesRouter.post('/discounts', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  const type = String(req.body?.type ?? '').toUpperCase();
  const value = Number(req.body?.value);
  const head_id = req.body?.head_id ? String(req.body.head_id) : null;
  if (!name || !['PERCENT', 'FLAT'].includes(type) || !Number.isInteger(value) || value <= 0) return res.status(400).json({ error: 'name, type (PERCENT|FLAT) and a positive whole-number value required' });
  if (type === 'PERCENT' && value > 100) return res.status(400).json({ error: 'Percent cannot be more than 100' });
  if (type === 'FLAT' && !head_id) return res.status(400).json({ error: 'A flat discount must be tied to one fee head' });
  if (head_id && !(await prisma.feeHead.findFirst({ where: { id: head_id, school_id: sid }, select: { id: true } }))) return res.status(400).json({ error: 'Unknown fee head' });
  const d = await prisma.discount.create({ data: { school_id: sid, name, type, value, head_id } }).catch(dupToConflict('A discount with this name already exists'));
  res.status(201).json(d);
}));

feesRouter.patch('/discounts/:id', adminOnly, wrap(async (req, res) => {
  const r = await prisma.discount.updateMany({ where: { id: req.params.id, school_id: schoolId(req) }, data: { is_active: !!req.body?.is_active } });
  if (!r.count) return res.status(404).json({ error: 'Discount not found' });
  res.json({ ok: true });
}));

/* GET /api/fees/discounts/student?unique_no=STU-0001 -> student + discounts assigned to them */
feesRouter.get('/discounts/student', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const q = String(req.query.unique_no ?? '').trim();
  const student = await prisma.student.findFirst({ where: { school_id: sid, OR: [{ unique_no: q.toUpperCase() }, { unique_no: q }] }, select: { id: true, name: true, class: true, section: true, unique_no: true } });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const rows = await prisma.studentDiscount.findMany({ where: { school_id: sid, student_id: student.id }, orderBy: { createdAt: 'asc' } });
  const defs = rows.length ? await prisma.discount.findMany({ where: { id: { in: rows.map((r) => r.discount_id) } } }) : [];
  res.json({
    student,
    assigned: rows.map((r) => { const d = defs.find((x) => x.id === r.discount_id); return { id: r.id, name: d?.name ?? '?', type: d?.type, value: d?.value, is_active: d?.is_active, assigned_by: r.assigned_by, createdAt: r.createdAt }; }),
  });
}));

feesRouter.post('/discounts/assign', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const q = String(req.body?.unique_no ?? '').trim();
  const student = await prisma.student.findFirst({ where: { school_id: sid, unique_no: q }, select: { id: true } });
  const discount = await prisma.discount.findFirst({ where: { id: String(req.body?.discount_id ?? ''), school_id: sid, is_active: true }, select: { id: true } });
  if (!student || !discount) return res.status(404).json({ error: 'Student or discount not found' });
  await prisma.studentDiscount.create({ data: { school_id: sid, student_id: student.id, discount_id: discount.id, assigned_by: req.user!.name } })
    .catch(dupToConflict('This discount is already assigned to the student'));
  res.status(201).json({ ok: true });
}));

feesRouter.delete('/discounts/assign/:id', adminOnly, wrap(async (req, res) => {
  const r = await prisma.studentDiscount.deleteMany({ where: { id: req.params.id, school_id: schoolId(req) } });
  if (!r.count) return res.status(404).json({ error: 'Assignment not found' });
  res.json({ ok: true });
}));

/* ============================ DISCOUNT REPORT (admin) ============================ */

feesRouter.get('/discount-report', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const fy = fyParam(req);

  const [others, otherTotal, assigned] = await Promise.all([
    prisma.discountEntry.findMany({ where: { school_id: sid, fy }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.discountEntry.aggregate({ where: { school_id: sid, fy }, _sum: { amount: true } }),
    prisma.studentDiscount.findMany({ where: { school_id: sid }, orderBy: { createdAt: 'desc' }, take: 200 }),
  ]);
  const studentIds = [...new Set([...others.map((o) => o.student_id), ...assigned.map((a) => a.student_id)])];
  const students = studentIds.length ? await prisma.student.findMany({ where: { id: { in: studentIds }, school_id: sid }, select: { id: true, name: true, class: true, unique_no: true, uses_transport: true, admission_date: true } }) : [];
  const sMap = new Map(students.map((s) => [s.id, s]));
  const heads = await prisma.feeHead.findMany({ where: { school_id: sid }, select: { id: true, name: true } });
  const hMap = new Map(heads.map((h) => [h.id, h.name]));
  hMap.set('__LATE__', 'Late fee');
  const dMap = new Map((await prisma.discount.findMany({ where: { school_id: sid } })).map((d) => [d.id, d]));

  // rupee value of each admin discount for this year comes from the same ledger the collector sees
  const ledgers = new Map<string, Awaited<ReturnType<typeof loadLedger>>>();
  for (const a of assigned) {
    const s = sMap.get(a.student_id);
    if (s && !ledgers.has(s.id)) ledgers.set(s.id, await loadLedger(prisma, sid, s, fy));
  }
  const adminRows = assigned.map((a) => {
    const s = sMap.get(a.student_id); const d = dMap.get(a.discount_id);
    const amount = ledgers.get(a.student_id)?.heads.reduce((t, h) => t + (h.admin_breakdown.find((b) => b.discount_id === a.discount_id)?.amount ?? 0), 0) ?? 0;
    return { id: a.id, student: s?.name ?? '?', unique_no: s?.unique_no ?? '?', class: s?.class ?? '', discount: d?.name ?? '?', type: d?.type, value: d?.value, active: d?.is_active ?? false, amount, assigned_by: a.assigned_by, date: a.createdAt };
  });
  res.json({
    fy: { start: fy, label: fyLabel(fy) },
    totals: { admin: adminRows.reduce((t, r) => t + (r.active ? r.amount : 0), 0), other: otherTotal._sum.amount ?? 0 },
    admin: adminRows,
    other: others.map((o) => { const s = sMap.get(o.student_id); return { id: o.id, date: o.createdAt, student: s?.name ?? '?', unique_no: s?.unique_no ?? '?', class: s?.class ?? '', head: hMap.get(o.head_id) ?? '?', amount: o.amount, reason: o.reason, given_by: o.given_by_name }; }),
  });
}));

/* ============================ FEE COLLECTOR ACCOUNTS (admin) ============================ */

feesRouter.get('/collectors', adminOnly, wrap(async (req, res) => {
  const data = await prisma.user.findMany({
    where: { school_id: schoolId(req), role: 'FEES_COLLECTOR' }, orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  res.json({ data });
}));

feesRouter.post('/collectors', adminOnly, wrap(async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (!name || !email || !password || String(password).length < 6)
    return res.status(400).json({ error: 'name, email and password (min 6 chars) required' });
  const mail = String(email).toLowerCase().trim();
  if (await prisma.user.findUnique({ where: { email: mail }, select: { id: true } }))
    return res.status(409).json({ error: 'Email already exists' });
  const u = await prisma.user.create({
    data: { name: String(name).trim(), email: mail, password: await bcrypt.hash(String(password), 10), role: 'FEES_COLLECTOR', school_id: schoolId(req) },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  res.status(201).json(u);
}));

feesRouter.delete('/collectors/:id', adminOnly, wrap(async (req, res) => {
  const r = await prisma.user.deleteMany({ where: { id: req.params.id, school_id: schoolId(req), role: 'FEES_COLLECTOR' } });
  if (!r.count) return res.status(404).json({ error: 'Collector not found' });
  res.json({ ok: true });
}));

/* ============================ FEE MONTHS: which months each fee is collected (admin) ============================ */

const monthsFlags = (v: unknown) => (Array.isArray(v) && v.length === 12 ? v.map((x) => x !== false) : null);

/* GET /api/fees/month-map?fy=2026&scope=SCHOOL|CLASS|STUDENT&class=5&unique_no=STU-0001 */
feesRouter.get('/month-map', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const fy = fyParam(req);
  const scope = String(req.query.scope ?? 'SCHOOL').toUpperCase();
  if (!['SCHOOL', 'CLASS', 'STUDENT'].includes(scope)) return res.status(400).json({ error: 'scope must be SCHOOL, CLASS or STUDENT' });

  let cls = '', student: { id: string; name: string; class: string; unique_no: string } | null = null;
  if (scope === 'CLASS') { cls = String(req.query.class ?? '').trim(); if (!cls) return res.status(400).json({ error: 'Choose a class' }); }
  if (scope === 'STUDENT') {
    const q = String(req.query.unique_no ?? '').trim();
    student = await prisma.student.findFirst({ where: { school_id: sid, OR: [{ unique_no: q.toUpperCase() }, { unique_no: q }] }, select: { id: true, name: true, class: true, unique_no: true } });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    cls = student.class;
  }
  const [heads, rows] = await Promise.all([
    prisma.feeHead.findMany({ where: { school_id: sid, is_active: true }, orderBy: { createdAt: 'asc' } }),
    prisma.feeMonthMap.findMany({
      where: { school_id: sid, fy, OR: [{ scope: 'SCHOOL' }, ...(cls ? [{ scope: 'CLASS', class: cls }] : []), ...(student ? [{ scope: 'STUDENT', student_id: student.id }] : [])] },
      select: { scope: true, class: true, student_id: true, head_id: true, months: true },
    }),
  ]);
  const own = (h: string) => rows.find((r) => r.head_id === h && r.scope === scope);
  const upper = rows.filter((r) => (scope === 'STUDENT' ? r.scope !== 'STUDENT' : scope === 'CLASS' ? r.scope === 'SCHOOL' : false));
  res.json({
    fy: { start: fy, label: fyLabel(fy) }, scope, class: cls, student,
    heads: heads.map((h) => {
      const o = own(h.id);
      const inherited = resolveMonths(upper as MapRow[], h.id, cls, student?.id ?? '');
      return { head_id: h.id, name: h.name, own: !!o, months: o ? monthsFlags(o.months) : inherited.months, inherited_from: inherited.source };
    }),
  });
}));

/* PUT /api/fees/month-map  { fy, scope, class?, unique_no?, items: [{ head_id, months: boolean[12] | null }] }  (null = remove, use the higher level) */
feesRouter.put('/month-map', adminOnly, wrap(async (req, res) => {
  const sid = schoolId(req);
  const fy = fyParam({ query: { fy: req.body?.fy } });
  const scope = String(req.body?.scope ?? '').toUpperCase();
  if (!['SCHOOL', 'CLASS', 'STUDENT'].includes(scope)) return res.status(400).json({ error: 'scope must be SCHOOL, CLASS or STUDENT' });
  let cls = '', student_id = '';
  if (scope === 'CLASS') { cls = String(req.body?.class ?? '').trim(); if (!cls) return res.status(400).json({ error: 'Choose a class' }); }
  if (scope === 'STUDENT') {
    const q = String(req.body?.unique_no ?? '').trim();
    const st = await prisma.student.findFirst({ where: { school_id: sid, unique_no: q }, select: { id: true } });
    if (!st) return res.status(404).json({ error: 'Student not found' });
    student_id = st.id;
  }
  const raw: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
  const items = raw.map((i) => ({ head_id: String(i?.head_id ?? ''), months: i?.months === null ? null : monthsFlags(i?.months) }));
  if (!items.length || !items.every((i) => i.head_id && (i.months !== undefined)) || items.some((i) => i.months === undefined)) return res.status(400).json({ error: 'items with head_id and 12 month flags required' });
  const valid = await prisma.feeHead.count({ where: { school_id: sid, id: { in: items.map((i) => i.head_id) } } });
  if (valid !== new Set(items.map((i) => i.head_id)).size) return res.status(400).json({ error: 'Unknown fee head' });

  const by = req.user!.name;
  await prisma.$transaction(items.map((i) => {
    const key = { school_id: sid, fy, scope, class: cls, student_id, head_id: i.head_id };
    return i.months === null
      ? prisma.feeMonthMap.deleteMany({ where: key })
      : prisma.feeMonthMap.upsert({ where: { school_id_fy_scope_class_student_id_head_id: key }, update: { months: i.months, set_by: by }, create: { ...key, months: i.months, set_by: by } });
  }));
  res.json({ ok: true });
}));

/* ============================ DUE DATE + LATE FEE (admin) ============================ */

feesRouter.get('/settings', canCollect, wrap(async (req, res) => {
  const s = await prisma.school.findUnique({ where: { id: schoolId(req) }, select: { fee_due_day: true, late_fee_amount: true, late_fee_from: true } });
  res.json({ due_day: s?.fee_due_day ?? 10, late_fee_amount: s?.late_fee_amount ?? 0, late_fee_from: s?.late_fee_from ? s.late_fee_from.toISOString().slice(0, 10) : '' });
}));

feesRouter.put('/settings', adminOnly, wrap(async (req, res) => {
  const due = Number(req.body?.due_day), late = Number(req.body?.late_fee_amount ?? 0);
  if (!Number.isInteger(due) || due < 1 || due > 28) return res.status(400).json({ error: 'Last date must be a day from 1 to 28' });
  if (!Number.isInteger(late) || late < 0 || late > 100000) return res.status(400).json({ error: 'Late fee must be a whole number, 0 or more' });
  const sid = schoolId(req);
  const cur = await prisma.school.findUnique({ where: { id: sid }, select: { late_fee_from: true } });
  const fromRaw = String(req.body?.late_fee_from ?? '').trim();
  // first time a late fee is switched on: start from today so old unpaid months are not charged retroactively
  let from: Date | null = cur?.late_fee_from ?? null;
  if (fromRaw) { try { from = parseDateOnly(fromRaw); } catch { return res.status(400).json({ error: 'Invalid "late fee from" date' }); } }
  else if (late > 0 && !from) from = localDateOnly();
  await prisma.school.update({ where: { id: sid }, data: { fee_due_day: due, late_fee_amount: late, late_fee_from: from } });
  res.json({ ok: true, late_fee_from: from ? from.toISOString().slice(0, 10) : '' });
}));
