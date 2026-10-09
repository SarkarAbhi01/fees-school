import { prisma } from '../prisma';
import { FY_MONTH_FULL, fyLabel } from './time';

/** One receipt, in the exact shape the screen prints. Used for the first print and for every reprint. */
export async function buildReceipt(sid: string, paymentId: string) {
  const p = await prisma.feePayment.findFirst({ where: { id: paymentId, school_id: sid } });
  if (!p) return null;
  const [student, school, lines, discs, collector] = await Promise.all([
    prisma.student.findFirst({ where: { id: p.student_id, school_id: sid }, select: { name: true, class: true, section: true, unique_no: true } }),
    prisma.school.findUnique({ where: { id: sid }, select: { name: true } }),
    prisma.feePaymentLine.findMany({ where: { school_id: sid, payment_id: p.id }, select: { head_id: true, head_name: true, amount: true, month_idx: true } }),
    prisma.discountEntry.findMany({ where: { school_id: sid, payment_id: p.id }, select: { head_id: true, amount: true, reason: true, month_idx: true } }),
    p.collected_by ? prisma.user.findUnique({ where: { id: p.collected_by }, select: { name: true } }) : null,
  ]);

  const byHead = new Map<string, { head_name: string; amount: number; other_discount: number }>();
  for (const l of lines) { const e = byHead.get(l.head_id); byHead.set(l.head_id, { head_name: l.head_name as string, amount: (e?.amount ?? 0) + l.amount, other_discount: 0 }); }
  const monthIdx = [...new Set([...lines.map((l) => l.month_idx), ...discs.map((d) => d.month_idx)].filter((m): m is number => m !== null))].sort((a, b) => a - b);
  const missing = discs.map((d) => d.head_id).filter((h) => !byHead.has(h));
  const names = missing.length ? new Map((await prisma.feeHead.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })).map((h) => [h.id, h.name])) : new Map<string, string>();
  for (const d of discs) {
    const e = byHead.get(d.head_id) ?? { head_name: names.get(d.head_id) ?? 'Fee', amount: 0, other_discount: 0 };
    e.other_discount += d.amount;
    byHead.set(d.head_id, e);
  }

  return {
    receipt_no: p.receipt_no, date: p.payment_date, school_name: school?.name ?? '',
    student_name: student?.name ?? '', class: student?.class ?? '', section: student?.section ?? '', unique_no: student?.unique_no ?? '',
    fy_label: fyLabel(p.fy || new Date(p.payment_date).getUTCFullYear()),
    billing_mode: p.billing_mode, months: p.months, payment_mode: p.payment_mode,
    lines: [...byHead.values()],
    amount_paid: p.amount_paid, discount_amount: p.discount_amount, discount_reason: discs[0]?.reason ?? null,
    fee_months: monthIdx.map((m) => FY_MONTH_FULL[m]),
    collected_by_name: collector?.name ?? null, reprint_count: p.reprint_count,
  };
}
