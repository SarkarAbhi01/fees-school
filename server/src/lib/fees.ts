import { Prisma } from '@prisma/client';
import { MONTH_NAMES, localDateOnly } from './time';
import {
  ALL_MONTHS, Credit, DiscountDef, HeadCalc, Installment, LATE_ID, asInstallments, billedMonths, calcHead, lateHead, lateMonths,
} from './feeCalc';

export * from './feeCalc';
type Db = Prisma.TransactionClient;

export interface StudentFeeInfo { id: string; class: string; uses_transport: boolean; admission_date: Date | null }

export const dayOf = (d: Date) => localDateOnly(d).getTime();

export type MapRow = { scope: string; class: string; student_id: string; head_id: string; months: unknown };
const asMonths = (v: unknown): boolean[] => (Array.isArray(v) && v.length === 12 ? v.map((x) => x !== false) : ALL_MONTHS());

/** Months a head is collected for one student: STUDENT > CLASS > SCHOOL > every month. */
export function resolveMonths(rows: MapRow[], head_id: string, cls: string, student_id: string) {
  const pick = (scope: string, f: (r: MapRow) => boolean) => rows.find((r) => r.head_id === head_id && r.scope === scope && f(r));
  const r = pick('STUDENT', (x) => x.student_id === student_id) ?? pick('CLASS', (x) => x.class === cls) ?? pick('SCHOOL', () => true);
  return r ? { months: asMonths(r.months), source: r.scope } : { months: ALL_MONTHS(), source: 'DEFAULT' };
}

/** Fee position of one student for one financial year. */
export async function loadLedger(db: Db, sid: string, s: StudentFeeInfo, fy: number) {
  const { n, startIdx } = billedMonths(s.admission_date, fy);
  const [classItems, custom, school, mapRows] = await Promise.all([
    db.classFee.findMany({ where: { school_id: sid, class: s.class } }),
    db.studentFee.findMany({ where: { school_id: sid, student_id: s.id } }),
    db.school.findUnique({ where: { id: sid }, select: { fee_due_day: true, late_fee_amount: true, late_fee_from: true } }),
    db.feeMonthMap.findMany({
      where: { school_id: sid, fy, OR: [{ scope: 'SCHOOL' }, { scope: 'CLASS', class: s.class }, { scope: 'STUDENT', student_id: s.id }] },
      select: { scope: true, class: true, student_id: true, head_id: true, months: true },
    }),
  ]);
  // class amount first, then this student's special fee replaces it (amount 0 = exempt from the head)
  const rateBy = new Map<string, { amount: number; period: string; installments: Installment[]; custom: boolean }>();
  for (const i of classItems) rateBy.set(i.head_id, { amount: i.amount, period: i.period, installments: asInstallments(i.installments), custom: false });
  for (const c of custom) {
    if (c.amount > 0) rateBy.set(c.head_id, { amount: c.amount, period: c.period, installments: asInstallments(c.installments), custom: true });
    else rateBy.delete(c.head_id);
  }
  const headIds = [...rateBy.keys()];
  const heads = headIds.length
    ? await db.feeHead.findMany({ where: { school_id: sid, id: { in: headIds }, is_active: true }, orderBy: { createdAt: 'asc' } })
    : [];

  const [assigned, others, lines, pays] = await Promise.all([
    db.studentDiscount.findMany({ where: { school_id: sid, student_id: s.id }, select: { discount_id: true } }),
    db.discountEntry.findMany({ where: { school_id: sid, student_id: s.id, fy }, select: { head_id: true, month_idx: true, amount: true, createdAt: true } }),
    db.feePaymentLine.findMany({ where: { school_id: sid, student_id: s.id, fy }, select: { payment_id: true, head_id: true, month_idx: true, amount: true } }),
    db.feePayment.findMany({ where: { school_id: sid, student_id: s.id, fy }, select: { id: true, payment_date: true } }),
  ]);
  const discounts: DiscountDef[] = assigned.length
    ? await db.discount.findMany({ where: { school_id: sid, id: { in: assigned.map((a) => a.discount_id) }, is_active: true }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, type: true, value: true, head_id: true } })
    : [];

  const payDay = new Map(pays.map((p) => [p.id, dayOf(p.payment_date)]));
  const creditsOf = (head_id: string): Credit[] => [
    ...lines.filter((l) => l.head_id === head_id).map((l) => ({ month: l.month_idx, amount: l.amount, day: payDay.get(l.payment_id) ?? 0 })),
    ...others.filter((o) => o.head_id === head_id).map((o) => ({ month: o.month_idx, amount: o.amount, day: dayOf(o.createdAt) })),
  ];
  const sumOf = (head_id: string) => lines.filter((l) => l.head_id === head_id).reduce((a, l) => a + l.amount, 0);
  const otherOf = (head_id: string) => others.filter((o) => o.head_id === head_id).reduce((a, l) => a + l.amount, 0);

  const calc = heads
    .filter((h) => !h.transport_only || s.uses_transport)
    .map((h) => {
      const r = rateBy.get(h.id)!;
      const mp = resolveMonths(mapRows, h.id, s.class, s.id);
      const c = calcHead({
        head_id: h.id, name: h.name, period: r.period, rate: r.amount, installments: r.installments, transport_only: h.transport_only, n, discounts,
        credits: creditsOf(h.id), other: otherOf(h.id), paid: sumOf(h.id), enabled: mp.months, map_source: mp.source,
      });
      return { ...c, is_custom: r.custom };
    });

  // one flat late fee per late month (not per fee head)
  const lateAmount = school?.late_fee_amount ?? 0;
  const out: HeadCalc[] = calc.map(({ bd: _bd, ...h }) => h);
  let late_months: number[] = [];
  if (lateAmount > 0 && calc.length) {
    const flags = lateMonths({
      fy, dueDay: school?.fee_due_day ?? 10, today: dayOf(new Date()), from: school?.late_fee_from ? school.late_fee_from.getTime() : null,
      heads: calc.map((h) => ({ bd: h.bd, credits: creditsOf(h.head_id) })),
    });
    const lh = lateHead(lateAmount, flags, creditsOf(LATE_ID), otherOf(LATE_ID), sumOf(LATE_ID));
    if (lh) { out.push(lh); late_months = flags.map((f, i) => (f ? i : -1)).filter((i) => i >= 0); }
  }

  const fees = out.filter((h) => !h.is_late);
  const sum = (list: HeadCalc[], f: (h: HeadCalc) => number) => list.reduce((a, h) => a + f(h), 0);
  const lateRow = out.find((h) => h.is_late);
  return {
    fy, billed_months: n, billing_from: n > 0 ? `${MONTH_NAMES[startIdx]} ${startIdx <= 8 ? fy : fy + 1}` : null,
    class_has_structure: classItems.length > 0 || custom.length > 0,
    heads: out,
    discounts,
    late: { amount: lateAmount, due_day: school?.fee_due_day ?? 10, months: late_months, total: lateRow?.base ?? 0, paid: lateRow?.paid ?? 0, left: lateRow?.left ?? 0 },
    totals: {
      gross: sum(fees, (h) => h.gross), admin_discount: sum(fees, (h) => h.admin_discount), other_discount: sum(fees, (h) => h.other_discount),
      paid: sum(fees, (h) => h.paid), left: sum(out, (h) => h.left), fee_left: sum(fees, (h) => h.left),
    },
  };
}
