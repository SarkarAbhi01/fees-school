import { rupees } from './api';

export type FeePeriod = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY' | 'CUSTOM';
export interface Inst { label: string; month: number; amount: number }
/** What the admin is typing (strings while editing). */
export interface FeeInput { amount: string; period: FeePeriod; installments: { label: string; month: number; amount: string }[] }

export const FEE_PERIODS: { value: FeePeriod; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly' }, { value: 'QUARTERLY', label: 'Quarterly' }, { value: 'HALF_YEARLY', label: 'Half-yearly' },
  { value: 'YEARLY', label: 'Yearly' }, { value: 'CUSTOM', label: 'Exam-wise / instalments' },
];
/** The financial year always runs April to March. Index 0 = April. */
export const FY_MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
export const SHORT_MONTHS = FY_MONTHS.map((m) => m.slice(0, 3));

export const annualOf = (period: string, amount: number, inst?: Inst[] | null) =>
  period === 'MONTHLY' ? amount * 12 : period === 'QUARTERLY' ? amount * 4 : period === 'HALF_YEARLY' ? amount * 2 : period === 'CUSTOM' ? (inst ?? []).reduce((t, i) => t + i.amount, 0) : amount;

export const describeFee = (period: string, amount: number, inst?: Inst[] | null) =>
  period === 'MONTHLY' ? `${rupees(amount)} /month` : period === 'QUARTERLY' ? `${rupees(amount)} /quarter` : period === 'HALF_YEARLY' ? `${rupees(amount)} /half-year`
  : period === 'CUSTOM' ? `${(inst ?? []).length} instalment${(inst ?? []).length === 1 ? '' : 's'} · ${rupees(annualOf(period, amount, inst))}` : `${rupees(amount)} /year`;

export const emptyInput = (period: FeePeriod = 'MONTHLY'): FeeInput => ({ amount: '', period, installments: [] });
export const toInput = (period: FeePeriod | null | undefined, amount: number | null | undefined, inst?: Inst[] | null): FeeInput => ({
  amount: amount === null || amount === undefined || period === 'CUSTOM' ? '' : String(amount),
  period: period ?? 'MONTHLY',
  installments: (inst ?? []).map((i) => ({ label: i.label, month: i.month, amount: String(i.amount) })),
});
/** Body sent to the API. amount null = "not set" (use the class fee). */
export const toPayload = (v: FeeInput) => ({
  amount: v.period === 'CUSTOM' ? (v.installments.length ? 1 : null) : v.amount === '' ? null : Number(v.amount),
  period: v.period,
  installments: v.period === 'CUSTOM' ? v.installments.map((i) => ({ label: i.label, month: i.month, amount: Number(i.amount) })) : undefined,
});
export const inputYearly = (v: FeeInput) =>
  v.period === 'CUSTOM' ? v.installments.reduce((t, i) => t + Number(i.amount || 0), 0) : annualOf(v.period, Number(v.amount || 0));
