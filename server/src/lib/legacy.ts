import { prisma } from '../prisma';
import { fyOfDateOnly } from './time';

/**
 * One-time, idempotent conversion of data saved by the previous fee screens:
 *  - old per-class totals (FeeStructure)  -> fee heads + ClassFee
 *  - old payments without lines           -> one FeePaymentLine on the matching head, with the financial year filled in
 */
export async function migrateLegacyFees() {
  const ensureHead = async (school_id: string, name: string, transport_only = false) =>
    (await prisma.feeHead.upsert({ where: { school_id_name: { school_id, name } }, update: {}, create: { school_id, name, transport_only } })).id;

  for (const o of await prisma.feeStructure.findMany()) {
    if (await prisma.classFee.count({ where: { school_id: o.school_id, class: o.class } })) continue;
    const allZero = !o.tuition_fee && !o.transport_fee && !o.library_fee;
    const rows: [string, boolean, number][] = [
      ['Tuition fee', false, allZero ? o.total_annual_fee : o.tuition_fee],
      ['Transport fee', true, o.transport_fee],
      ['Library fee', false, o.library_fee],
    ];
    for (const [name, tr, amount] of rows) {
      if (amount <= 0) continue;
      await prisma.classFee.create({ data: { school_id: o.school_id, class: o.class, head_id: await ensureHead(o.school_id, name, tr), amount, period: 'YEARLY' } });
    }
  }

  const names: Record<string, [string, boolean]> = { TUITION: ['Tuition fee', false], TRANSPORT: ['Transport fee', true], LIBRARY: ['Library fee', false] };
  for (;;) {
    const batch = await prisma.feePayment.findMany({ where: { fy: 0 }, take: 200 });
    if (!batch.length) break;
    for (const p of batch) {
      const [name, tr] = names[p.fee_type] ?? names.TUITION;
      const head_id = await ensureHead(p.school_id, name, tr);
      const pd = new Date(Date.UTC(p.payment_date.getUTCFullYear(), p.payment_date.getUTCMonth(), p.payment_date.getUTCDate()));
      const fy = fyOfDateOnly(pd);
      await prisma.$transaction([
        prisma.feePaymentLine.create({ data: { school_id: p.school_id, payment_id: p.id, student_id: p.student_id, fy, head_id, head_name: name, amount: p.amount_paid } }),
        prisma.feePayment.update({ where: { id: p.id }, data: { fy } }),
      ]);
    }
  }
}
