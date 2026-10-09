/** Month-wise payment helpers for the Collect Fee screen. Pure maths, no React. */
export type Plan = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';
export const PLANS: { value: Plan; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly' }, { value: 'QUARTERLY', label: 'Quarterly (3 months)' },
  { value: 'HALF_YEARLY', label: 'Half-yearly (6 months)' }, { value: 'YEARLY', label: 'Yearly (all unpaid months)' },
];
export const planCount = (plan: Plan, months: number) => (plan === 'MONTHLY' ? months : plan === 'QUARTERLY' ? 3 : plan === 'HALF_YEARLY' ? 6 : 12);

export interface MonthCell { m: number; due: number; covered: number; left: number }
export interface PlanHead { head_id: string; name: string; is_late?: boolean; left: number; months: MonthCell[]; enabled: boolean[] }

/** Fee months (0 = April ... 11 = March) in which something is still unpaid, across every fee and the late fee. */
export const payableMonths = (heads: PlanHead[]) =>
  [...Array(12).keys()].filter((m) => heads.some((h) => (h.months[m]?.left ?? 0) > 0));

/** The months chosen by the dropdown: the picked month and the next ones that are still payable (N of them for the plan). */
export function chosenMonths(heads: PlanHead[], start: number | null, plan: Plan, months: number) {
  const open = payableMonths(heads);
  if (plan === 'YEARLY') return open;
  const from = start ?? open[0];
  return open.filter((m) => m >= from).slice(0, planCount(plan, months));
}

export const monthLeft = (h: PlanHead, chosen: number[]) => chosen.reduce((t, m) => t + (h.months[m]?.left ?? 0), 0);

/** What to charge per head for the chosen months, after the discount typed for that head. */
export function suggest(heads: PlanHead[], chosen: number[], discount: Record<string, number> = {}) {
  const out: Record<string, number> = {};
  for (const h of heads) out[h.head_id] = Math.max(0, monthLeft(h, chosen) - (discount[h.head_id] ?? 0));
  return out;
}

/** Status of one month for the 12 month strip. */
export function monthStatus(heads: PlanHead[], m: number): 'paid' | 'due' | 'off' | 'none' {
  const dues = heads.filter((h) => (h.months[m]?.due ?? 0) > 0);
  if (!dues.length) return heads.some((h) => !h.is_late && h.enabled[m] === false) ? 'off' : 'none';
  return dues.some((h) => h.months[m].left > 0) ? 'due' : 'paid';
}
