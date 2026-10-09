import { useEffect, useState } from 'react';
import { api, rupees } from '../lib/api';
import { ErrorText, Panel, td, th } from '../components/ui';

interface Report {
  fy: { label: string }; totals: { admin: number; other: number };
  admin: { id: string; student: string; unique_no: string; class: string; discount: string; type: string; value: number; active: boolean; amount: number; assigned_by: string; date: string }[];
  other: { id: string; date: string; student: string; unique_no: string; class: string; head: string; amount: number; reason: string; given_by: string }[];
}

export default function DiscountReport() {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<Report>('/api/fees/discount-report').then(setR).catch((e) => setError(e.message)); }, []);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Discount Report{r ? ` · FY ${r.fy.label}` : ''}</h1>
      <ErrorText>{error}</ErrorText>
      {r && (
        <>
          <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2">
            <div className="bg-white p-6"><p className="text-sm text-slate-500">Admin discounts (this year)</p><p className="mt-2 font-display text-4xl font-bold text-board">{rupees(r.totals.admin)}</p></div>
            <div className="bg-white p-6"><p className="text-sm text-slate-500">Other discounts given by collectors</p><p className="mt-2 font-display text-4xl font-bold text-late">{rupees(r.totals.other)}</p></div>
          </div>

          <Panel className="overflow-hidden">
            <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Other discounts (given on the spot)</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50"><tr><th className={th}>Date</th><th className={th}>Student</th><th className={th}>Fee</th><th className={th}>Amount</th><th className={th}>Reason</th><th className={th}>Given by</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {r.other.map((o) => (
                    <tr key={o.id}>
                      <td className={td}>{new Date(o.date).toLocaleDateString('en-IN')}</td>
                      <td className={td}>{o.student} <span className="text-slate-500">({o.unique_no}, Class {o.class})</span></td>
                      <td className={td}>{o.head}</td><td className={`${td} font-semibold`}>{rupees(o.amount)}</td><td className={td}>{o.reason}</td><td className={td}>{o.given_by}</td>
                    </tr>
                  ))}
                  {r.other.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">No other discounts given this year.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Admin discounts (assigned to students)</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50"><tr><th className={th}>Assigned</th><th className={th}>Student</th><th className={th}>Discount</th><th className={th}>Worth this year</th><th className={th}>Assigned by</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {r.admin.map((a) => (
                    <tr key={a.id}>
                      <td className={td}>{new Date(a.date).toLocaleDateString('en-IN')}</td>
                      <td className={td}>{a.student} <span className="text-slate-500">({a.unique_no}, Class {a.class})</span></td>
                      <td className={td}>{a.discount} · {a.type === 'PERCENT' ? `${a.value}%` : rupees(a.value)}{!a.active && ' (inactive)'}</td>
                      <td className={`${td} font-semibold`}>{rupees(a.amount)}</td><td className={td}>{a.assigned_by}</td>
                    </tr>
                  ))}
                  {r.admin.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">No admin discounts assigned yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
