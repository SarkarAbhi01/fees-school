import { MONTH_NAMES, fyOfDateOnly } from './time';
import { HttpError } from './util';

export const PERIODS = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM'] as const;
export type Period = (typeof PERIODS)[number];
/** One billed instalment: month 0 = April ... 11 = March (the financial year). */
export type Installment = { label: string; month: number; amount: number };

export interface StudentFeeInfo { id: string; class: string; uses_transport: boolean; admission_date: Date | null }

/**
 * How a fee head is charged.
 *   MONTHLY / YEARLY  - spread evenly over the months billed (Rs 2400 a year = Rs 200 a month; can be paid month by month)
 *   QUARTERLY         - one instalment at the start of each quarter (Apr, Jul, Oct, Jan)
 *   HALF_YEARLY       - one instalment in Apr and one in Oct
 *   CUSTOM            - the admin lists each instalment, e.g. exam fees: Unit test 1 (Jun) 100, Half-yearly exam (Sep) 150 ...
 */
export function annualOf(period: string, amount: number, installments?: Installment[] | null) {
  switch (period) {
    case 'MONTHLY': return amount * 12;
    case 'QUARTERLY': return amount * 4;
    case 'HALF_YEARLY': return amount * 2;
    case 'CUSTOM': return (installments ?? []).reduce((t, i) => t + i.amount, 0);
    default: return amount;
  }
}

const isInt = (n: number) => Number.isInteger(n) && n >= 0;

/** Validate what the admin typed for one fee (used by Fee Structure and Custom Fees). */
export function parseFeeSpec(i: { amount?: unknown; period?: unknown; installments?: unknown }) {
  const period = String(i.period ?? 'YEARLY').toUpperCase() as Period;
  if (!PERIODS.includes(period)) throw new HttpError(400, 'Unknown fee period');
  if (period === 'CUSTOM') {
    const raw = Array.isArray(i.installments) ? i.installments : [];
    if (raw.length > 12) throw new HttpError(400, 'At most 12 instalments per fee');
    const installments: Installment[] = raw.map((x: any) => ({ label: String(x?.label ?? '').trim().slice(0, 40), month: Number(x?.month), amount: Number(x?.amount) }));
    for (const x of installments)
      if (!x.label || !Number.isInteger(x.month) || x.month < 0 || x.month > 11 || !Number.isInteger(x.amount) || x.amount <= 0)
        throw new HttpError(400, 'Each instalment needs a name, a month and a whole-number amount above 0');
    installments.sort((a, b) => a.month - b.month);
    return { period, amount: annualOf('CUSTOM', 0, installments), installments };
  }
  const amount = Number(i.amount ?? 0);
  if (!isInt(amount)) throw new HttpError(400, 'Amounts must be whole numbers, 0 or more');
  return { period, amount, installments: null as Installment[] | null };
}

export const asInstallments = (v: unknown): Installment[] =>
  (Array.isArray(v) ? v : []).map((x: any) => ({ label: String(x?.label ?? ''), month: Number(x?.month), amount: Number(x?.amount) })).filter((x) => x.amount > 0 && x.month >= 0 && x.month <= 11);

/** Billing for a student in a financial year. Billing starts at the admission month; the year always ends in March. */
export function billedMonths(admission: Date | null, fy: number) {
  if (!admission) return { n: 12, startIdx: 0 };
  const admFy = fyOfDateOnly(admission);
  if (admFy < fy) return { n: 12, startIdx: 0 };       // admitted in an earlier year: full year
  if (admFy > fy) return { n: 0, startIdx: 12 };       // admitted later: nothing billed in this year
  const startIdx = (admission.getUTCMonth() - 3 + 12) % 12; // Apr = 0 ... Mar = 11
  return { n: 12 - startIdx, startIdx };
}

/** Cumulative amount due after k of n billed months (rounded so instalments never drift from the total). */
export const cumulative = (base: number, n: number, k: number) => (n > 0 ? Math.round((base * k) / n) : 0);


/** Pseudo fee head used for the late fee (one flat amount per late month, not per fee head). */
export const LATE_ID = '__LATE__';
export const LATE_NAME = 'Late fee';
export const ALL_MONTHS = (): boolean[] => Array(12).fill(true);

export interface MonthCell { m: number; due: number; covered: number; left: number }
export interface Credit { month: number | null; amount: number; day: number }
export interface DiscountDef { id: string; name: string; type: string; value: number; head_id: string | null }

export interface HeadCalc {
  head_id: string; name: string; period: Period | 'LATE'; rate: number; installments: Installment[] | null; transport_only: boolean;
  is_late: boolean;
  gross: number; admin_discount: number; admin_breakdown: { discount_id: string; name: string; amount: number }[];
  other_discount: number; base: number; paid: number; left: number;
  is_custom: boolean; billed_months: number; start_idx: number;
  enabled: boolean[]; map_source: string;     // months this head is collected (Fee Months screen)
  months: MonthCell[];                         // per fee month: what is due (after discounts), covered, left
  paid_to: number;                             // last month (0 = Apr) up to which every due month is fully paid; -1 = none
  items: { label: string; month: number; amount: number; paid: boolean }[];
}

/** Charge of each month before discounts. A month switched off in the Fee Months screen charges nothing. */
export function grossByMonth(period: Period, rate: number, custom: Installment[], startIdx: number, enabled: boolean[]) {
  const g: number[] = Array(12).fill(0);
  const on = (m: number) => m >= startIdx && enabled[m] !== false;
  if (period === 'MONTHLY') { for (let m = 0; m < 12; m++) if (on(m)) g[m] = rate; }
  else if (period === 'YEARLY') {
    const ms = [...Array(12).keys()].filter(on);
    const total = Math.round((rate * ms.length) / 12);
    ms.forEach((m, j) => { g[m] = cumulative(total, ms.length, j + 1) - cumulative(total, ms.length, j); });
  } else {
    for (const x of lumpyItems(period, rate, custom, startIdx)) if (enabled[x.month] !== false) g[x.month] += x.amount;
  }
  return g;
}

/** Instalments actually billed for a lumpy fee, given the month the student's billing starts. */
function lumpyItems(period: Period, rate: number, custom: Installment[], startIdx: number) {
  const out: { label: string; month: number; amount: number }[] = [];
  if (period === 'CUSTOM') {
    // an exam that already happened before admission is not charged
    for (const x of custom) if (x.month >= startIdx) out.push({ label: x.label, month: x.month, amount: x.amount });
  } else {
    const len = period === 'QUARTERLY' ? 3 : 6;
    for (let start = 0; start < 12; start += len) {
      const end = start + len - 1;
      if (end < startIdx) continue;                                     // whole quarter/half before admission
      const label = `${MONTH_NAMES[start]}–${MONTH_NAMES[end]}`;
      if (start < startIdx) out.push({ label, month: startIdx, amount: Math.round((rate * (end - startIdx + 1)) / len) }); // joined mid-period: pro-rated
      else out.push({ label, month: start, amount: rate });
    }
  }
  return out.sort((a, b) => a.month - b.month);
}

/**
 * Pay-off of one head. Money paid for a named month goes to that month (extra over that month's due goes to the pool).
 * Old receipts without a month, other discounts and the pool pay the oldest unpaid month first.
 * asOf (a local day) = only count credits given on or before that day (used to find who paid after the due date).
 */
export function settle(bd: number[], credits: Credit[], asOf?: number) {
  const explicit: number[] = Array(12).fill(0);
  let pool = 0;
  for (const c of credits) {
    if (asOf !== undefined && c.day > asOf) continue;
    if (c.month !== null && c.month >= 0 && c.month <= 11) explicit[c.month] += c.amount; else pool += c.amount;
  }
  const covered = bd.map((d, m) => { const x = Math.min(explicit[m], d); pool += explicit[m] - x; return x; });
  for (let m = 0; m < 12 && pool > 0; m++) { const take = Math.min(bd[m] - covered[m], pool); covered[m] += take; pool -= take; }
  return covered;
}

function cells(bd: number[], covered: number[]): MonthCell[] {
  return bd.map((due, m) => ({ m, due, covered: covered[m], left: due - covered[m] }));
}
function paidTo(cs: MonthCell[]) {
  let to = -1;
  for (const c of cs) { if (c.due > 0 && c.left > 0) break; if (c.due > 0) to = c.m; }
  return to;
}

/** Pure calculation for one head (no DB), so it is easy to test. */
export function calcHead(o: {
  head_id: string; name: string; period: string; rate: number; installments?: Installment[] | null; transport_only: boolean; n: number;
  discounts: DiscountDef[]; credits: Credit[]; other: number; paid: number; enabled?: boolean[]; map_source?: string;
}): HeadCalc & { bd: number[] } {
  const period = (PERIODS as readonly string[]).includes(o.period) ? (o.period as Period) : 'YEARLY';
  const startIdx = 12 - o.n;
  const enabled = o.enabled ?? ALL_MONTHS();
  const custom = period === 'CUSTOM' ? o.installments ?? [] : [];
  const g = grossByMonth(period, o.rate, custom, startIdx, enabled);
  const gross = g.reduce((a, b) => a + b, 0);

  let room = gross;
  const admin_breakdown: HeadCalc['admin_breakdown'] = [];
  for (const d of o.discounts) {
    if (d.head_id && d.head_id !== o.head_id) continue;
    let amt = 0;
    if (d.type === 'PERCENT') amt = Math.round((gross * d.value) / 100);
    else if (d.type === 'FLAT' && d.head_id === o.head_id) amt = d.value;
    amt = Math.max(0, Math.min(amt, room));
    room -= amt;
    if (amt > 0) admin_breakdown.push({ discount_id: d.id, name: d.name, amount: amt });
  }
  const admin_discount = gross - room;
  const base = gross - admin_discount;

  // discount is shared out over the months in proportion to what each month charges
  const bd: number[] = Array(12).fill(0);
  let cum = 0, prev = 0;
  for (let m = 0; m < 12; m++) { cum += g[m]; const cb = gross ? Math.round((base * cum) / gross) : 0; bd[m] = cb - prev; prev = cb; }

  const covered = settle(bd, o.credits);
  const months = cells(bd, covered);
  const left = months.reduce((a, c) => a + c.left, 0);
  const lumps = period === 'QUARTERLY' || period === 'HALF_YEARLY' || period === 'CUSTOM' ? lumpyItems(period, o.rate, custom, startIdx).filter((x) => enabled[x.month] !== false) : [];

  return {
    head_id: o.head_id, name: o.name, period, rate: o.rate, installments: period === 'CUSTOM' ? custom : null, transport_only: o.transport_only, is_late: false,
    gross, admin_discount, admin_breakdown, other_discount: o.other, base, paid: o.paid, left, is_custom: false, billed_months: o.n, start_idx: startIdx,
    enabled, map_source: o.map_source ?? 'DEFAULT', months, paid_to: paidTo(months), bd,
    items: lumps.map((x) => ({ label: x.label, month: x.month, amount: x.amount, paid: months[x.month].left === 0 })),
  };
}

/** Calendar date (UTC midnight, ms) when fees of fee month m must be paid by. m = 0 is April of fy. */
export function dueDateOf(fy: number, m: number, dueDay: number) {
  const month = (3 + m) % 12, year = m <= 8 ? fy : fy + 1;
  const dim = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(Math.max(1, dueDay), dim));
}

/**
 * Which months carry a late fee: the month charges something, its due date has passed (and is not before the
 * "late fee from" date) and the month was not fully paid on or before the due date. One flat fee per month, whatever the heads.
 */
export function lateMonths(o: { fy: number; dueDay: number; today: number; from: number | null; heads: { bd: number[]; credits: Credit[] }[] }) {
  const late: boolean[] = Array(12).fill(false);
  for (let m = 0; m < 12; m++) {
    if (!o.heads.some((h) => h.bd[m] > 0)) continue;
    const due = dueDateOf(o.fy, m, o.dueDay);
    if (o.today <= due || (o.from !== null && due < o.from)) continue;
    late[m] = o.heads.some((h) => h.bd[m] > 0 && settle(h.bd, h.credits, due)[m] < h.bd[m]);
  }
  return late;
}

/** The late-fee pseudo head, so the collect screen treats it like any other fee row. */
export function lateHead(amount: number, late: boolean[], credits: Credit[], other: number, paid: number): HeadCalc | null {
  const bd = late.map((l) => (l ? amount : 0));
  if (!bd.some((x) => x > 0)) return null;
  const months = cells(bd, settle(bd, credits));
  const total = bd.reduce((a, b) => a + b, 0);
  return {
    head_id: LATE_ID, name: LATE_NAME, period: 'LATE', rate: amount, installments: null, transport_only: false, is_late: true,
    gross: total, admin_discount: 0, admin_breakdown: [], other_discount: other, base: total, paid, left: months.reduce((a, c) => a + c.left, 0),
    is_custom: false, billed_months: 0, start_idx: 0, enabled: late, map_source: 'LATE', months, paid_to: paidTo(months), items: [],
  };
}
