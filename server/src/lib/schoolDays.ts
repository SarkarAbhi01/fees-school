import { prisma } from '../prisma';
import { dateStr, localDateOnly } from './time';

export const parseOff = (v: string | null | undefined) => (v ?? '0').split(',').map((x) => x.trim()).filter((x) => /^[0-6]$/.test(x)).map(Number);

/**
 * School days in a month = every calendar day (up to today for the running month, nothing for a future month) that is
 *  - not a weekly off day (default Sunday) and not a declared holiday, OR
 *  - a day on which at least one student was actually marked present/late (a Sunday class, a make-up day).
 * This replaces the old Mon-Sat count, which ignored holidays and ignored days the school really ran.
 */
export async function schoolDays(sid: string, year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const [school, holidays, active] = await Promise.all([
    prisma.school.findUnique({ where: { id: sid }, select: { weekly_off: true } }),
    prisma.holiday.findMany({ where: { school_id: sid, date: { gte: from, lte: to } }, select: { date: true, name: true } }),
    prisma.attendance.groupBy({ by: ['date'], where: { school_id: sid, date: { gte: from, lte: to }, status: { in: ['PRESENT', 'LATE'] } } }),
  ]);
  const off = new Set(parseOff(school?.weekly_off));
  const hol = new Set(holidays.map((h) => dateStr(h.date)));
  const ran = new Set(active.map((a) => dateStr(a.date)));
  const today = localDateOnly().getTime();
  const days: string[] = [];
  for (let d = 1; d <= to.getUTCDate(); d++) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    if (dt.getTime() > today) break;
    const key = dateStr(dt);
    if (ran.has(key) || (!off.has(dt.getUTCDay()) && !hol.has(key))) days.push(key);
  }
  return { total: days.length, days, holidays: holidays.map((h) => ({ date: dateStr(h.date), name: h.name })), weekly_off: [...off] };
}
