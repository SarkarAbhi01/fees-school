import { todayStr } from '../lib/api';
import { Input } from './ui';

export interface Period { period: 'today' | 'yesterday' | 'week' | 'month' | 'custom'; from: string; to: string }
export const defaultPeriod = (): Period => ({ period: 'today', from: todayStr(), to: todayStr() });
export const periodQuery = (p: Period) => `period=${p.period}${p.period === 'custom' ? `&from=${p.from}&to=${p.to}` : ''}`;

const OPTIONS: [Period['period'], string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']];

export default function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="radiogroup" aria-label="Period" className="flex h-10 overflow-hidden rounded-md border border-slate-300">
        {OPTIONS.map(([k, label]) => (
          <button type="button" key={k} role="radio" aria-checked={value.period === k} onClick={() => onChange({ ...value, period: k })}
            className={`px-4 text-sm font-semibold ${value.period === k ? 'bg-board text-white' : 'bg-white text-ink hover:bg-board-50'}`}>{label}</button>
        ))}
      </div>
      {value.period === 'custom' && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Input type="date" value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} className="w-40" aria-label="From date" />
          <span>to</span>
          <Input type="date" value={value.to} min={value.from} max={todayStr()} onChange={(e) => onChange({ ...value, to: e.target.value })} className="w-40" aria-label="To date" />
        </div>
      )}
    </div>
  );
}
