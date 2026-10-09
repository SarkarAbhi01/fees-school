import { rupees } from '../lib/api';
import { FEE_PERIODS, FY_MONTHS, FeeInput, FeePeriod, inputYearly } from '../lib/feePeriods';
import { Button, Input, Select } from './ui';

/** Amount + how it is charged. "Exam-wise" lets the admin list each instalment (name, month, amount). */
export default function FeeAmountInput({ value, onChange, name, placeholder = '0' }: { value: FeeInput; onChange: (v: FeeInput) => void; name: string; placeholder?: string }) {
  const set = (patch: Partial<FeeInput>) => onChange({ ...value, ...patch });
  const setInst = (i: number, patch: Partial<FeeInput['installments'][number]>) => set({ installments: value.installments.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const custom = value.period === 'CUSTOM';
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {!custom && <Input type="number" min={0} inputMode="numeric" className="w-32" placeholder={placeholder} aria-label={`${name} amount`} value={value.amount} onChange={(e) => set({ amount: e.target.value })} />}
        <Select aria-label={`${name} charged`} value={value.period} onChange={(e) => set({ period: e.target.value as FeePeriod, installments: e.target.value === 'CUSTOM' && value.installments.length === 0 ? [{ label: '', month: 2, amount: '' }] : value.installments })}>
          {FEE_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
        {!custom && value.amount !== '' && <span className="self-center text-xs text-slate-500">{rupees(inputYearly(value))} a year</span>}
      </div>
      {custom && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          {value.installments.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_96px_auto] items-center gap-2">
              <Input placeholder="e.g. Unit test 1" maxLength={40} aria-label={`${name} instalment ${i + 1} name`} value={x.label} onChange={(e) => setInst(i, { label: e.target.value })} />
              <Select className="w-full" aria-label={`${name} instalment ${i + 1} month`} value={x.month} onChange={(e) => setInst(i, { month: Number(e.target.value) })}>
                {FY_MONTHS.map((m, k) => <option key={m} value={k}>{m}</option>)}
              </Select>
              <Input type="number" min={1} inputMode="numeric" placeholder="₹" aria-label={`${name} instalment ${i + 1} amount`} value={x.amount} onChange={(e) => setInst(i, { amount: e.target.value })} />
              <button type="button" aria-label={`Remove instalment ${i + 1}`} className="rounded-sm px-2 text-xl text-slate-500 hover:bg-slate-100" onClick={() => set({ installments: value.installments.filter((_, k) => k !== i) })}>×</button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button type="button" variant="outline" className="h-8 px-3" disabled={value.installments.length >= 12} onClick={() => set({ installments: [...value.installments, { label: '', month: 2, amount: '' }] })}>+ Add exam / instalment</Button>
            <span className="text-xs text-slate-600">Total a year: <b className="text-ink">{rupees(inputYearly(value))}</b></span>
          </div>
          <p className="text-xs text-slate-500">Example: Unit test 1 · June · ₹100, Half-yearly exam · September · ₹150. Students who join after an exam month are not charged for it.</p>
        </div>
      )}
    </div>
  );
}
