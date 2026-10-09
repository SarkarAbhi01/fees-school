// School-local time helpers (default IST = UTC+5:30). No date library needed.
export const tzOffsetMin = () => Number(process.env.TZ_OFFSET_MIN ?? 330);
const offsetMs = () => Number(process.env.TZ_OFFSET_MIN ?? 330) * 60000;

export function localParts(d: Date = new Date()) {
  const l = new Date(d.getTime() + offsetMs());
  return { y: l.getUTCFullYear(), m: l.getUTCMonth(), d: l.getUTCDate(), h: l.getUTCHours(), min: l.getUTCMinutes() };
}

/** Local calendar date as a UTC-midnight Date (what Prisma @db.Date expects). */
export function localDateOnly(d: Date = new Date()) {
  const p = localParts(d);
  return new Date(Date.UTC(p.y, p.m, p.d));
}

export function parseDateOnly(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) throw new Error('Invalid date, use YYYY-MM-DD');
  return new Date(Date.UTC(y, m - 1, d));
}

/** Real instant at which the local day started (for payment_date filters). */
export function startOfLocalDay(d: Date = new Date()) {
  return new Date(localDateOnly(d).getTime() - offsetMs());
}

/** Minutes after midnight (school time) after which a student counts as late. */
export const lateAfterMinutes = () => { const [lh, lm] = (process.env.LATE_AFTER ?? '08:30').split(':').map(Number); return lh * 60 + lm; };

export function isLate(d: Date) {
  const [lh, lm] = (process.env.LATE_AFTER ?? '08:30').split(':').map(Number);
  const p = localParts(d);
  return p.h * 60 + p.min > lh * 60 + lm;
}

export function formatLocalTime(d: Date) {
  const p = localParts(d);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${String(p.min).padStart(2, '0')} ${p.h >= 12 ? 'PM' : 'AM'}`;
}

/** Working days (Mon-Sat) in a month; for the current month only counts up to today. */
export function workingDays(year: number, month: number) {
  const today = localDateOnly();
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= dim; day++) {
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getTime() > today.getTime()) break;
    if (dt.getUTCDay() !== 0) count++; // Sunday off
  }
  return count;
}

/** YYYY-MM-DD for a UTC-midnight Date; used so raw SQL compares a DATE column with a DATE, not a timestamp. */
export const dateStr = (d: Date) => d.toISOString().slice(0, 10);

/* ---------- financial year: strictly April to March ---------- */
/** FY start year of a UTC-midnight date-only value (Apr 2026 .. Mar 2027 -> 2026). */
export const fyOfDateOnly = (d: Date) => (d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);
export const currentFy = () => { const p = localParts(); return p.m >= 3 ? p.y : p.y - 1; };
export const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
export const MONTH_NAMES = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

/** Real instants [start, end) covering local calendar days from..to (UTC-midnight date-only inputs, inclusive). */
export function localRangeInstants(from: Date, to: Date) {
  return { start: new Date(from.getTime() - offsetMs()), end: new Date(to.getTime() + 86400000 - offsetMs()) };
}
export const FY_MONTH_FULL = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
