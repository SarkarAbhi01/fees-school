import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rupees } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, ErrorText, Modal, Panel, td, th } from '../components/ui';
import FeeAmountInput from '../components/FeeAmountInput';
import { FeeInput, FeePeriod, Inst, SHORT_MONTHS, annualOf, describeFee, inputYearly, toInput, toPayload } from '../lib/feePeriods';

interface Head { id: string; name: string; transport_only: boolean }
interface Item { class: string; head_id: string; amount: number; period: FeePeriod; installments: Inst[] | null }
const CLASSES = Array.from({ length: 12 }, (_, i) => String(i + 1));

export default function FeeStructure() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SCHOOL_ADMIN';
  const [heads, setHeads] = useState<Head[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [edit, setEdit] = useState<{ cls: string; rows: Record<string, FeeInput> } | null>(null);

  const load = useCallback(async () => {
    try { const r = await api<{ heads: Head[]; items: Item[] }>('/api/fees/structure'); setHeads(r.heads); setItems(r.items); setError(''); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const find = (c: string, h: string) => items.find((i) => i.class === c && i.head_id === h);
  const yearly = (i: Item) => annualOf(i.period, i.amount, i.installments);

  function open(cls: string) {
    const rows: Record<string, FeeInput> = {};
    for (const h of heads) { const i = find(cls, h.id); rows[h.id] = toInput(i?.period, i?.amount, i?.installments); }
    setEdit({ cls, rows });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setError('');
    try {
      await api(`/api/fees/structure/${encodeURIComponent(edit.cls)}`, {
        method: 'PUT',
        body: { items: heads.map((h) => { const p = toPayload(edit.rows[h.id]); return { head_id: h.id, ...p, amount: p.amount ?? 0 }; }) },
      });
      setNotice(`Fee structure saved for Class ${edit.cls}.`); setEdit(null); load();
    } catch (err: any) { setError(err.message); }
  }

  const editYear = edit ? heads.reduce((t, h) => t + inputYearly(edit.rows[h.id]), 0) : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Fee Structure</h1>
      <p className="text-sm text-slate-500">Amount of each fee head per class. Charge it monthly, quarterly, half-yearly, yearly, or list exam-wise instalments (for example three exams at ₹100 and a half-yearly exam at ₹150). The financial year runs April to March; a student is billed from the month of admission.</p>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{notice}</p>}
      {heads.length === 0 && (
        <p className="rounded-md bg-late/10 px-3 py-2 text-sm text-late">
          No fee heads yet. {canEdit ? <>Create them first in <Link to="/fees/heads" className="font-semibold underline">Fee Heads</Link>.</> : 'Ask your school admin to create them.'}
        </p>
      )}
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Class</th>
                {heads.map((h) => <th key={h.id} className={th}>{h.name}{h.transport_only ? ' (transport)' : ''}</th>)}
                <th className={th}>Yearly total</th>{canEdit && <th className={th}></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {CLASSES.map((c) => {
                const row = items.filter((i) => i.class === c);
                return (
                  <tr key={c}>
                    <td className={`${td} font-semibold`}>Class {c}</td>
                    {row.length === 0
                      ? <td colSpan={heads.length + 1} className={`${td} text-late`}>No fee is set for Class {c}. Add a fee structure first.</td>
                      : <>
                        {heads.map((h) => {
                          const i = find(c, h.id);
                          return (
                            <td key={h.id} className={td}>
                              {i ? describeFee(i.period, i.amount, i.installments) : '—'}
                              {i?.period === 'CUSTOM' && <p className="text-xs text-slate-500">{(i.installments ?? []).map((x) => `${x.label} ${SHORT_MONTHS[x.month]} ${rupees(x.amount)}`).join(' · ')}</p>}
                            </td>
                          );
                        })}
                        <td className={`${td} font-semibold`}>{rupees(row.reduce((t, i) => t + yearly(i), 0))}</td>
                      </>}
                    {canEdit && <td className={td}><Button variant="outline" className="h-8 px-3" disabled={heads.length === 0} onClick={() => open(c)}>{row.length ? 'Edit' : 'Add'}</Button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {edit && (
        <Modal wide title={`Class ${edit.cls} fee structure`} onClose={() => setEdit(null)}>
          <form onSubmit={save} className="space-y-4">
            {heads.map((h) => (
              <div key={h.id} className="space-y-1.5">
                <span className="block text-sm font-medium text-slate-700">{h.name}{h.transport_only ? ' (transport students)' : ''}</span>
                <FeeAmountInput name={h.name} value={edit.rows[h.id]} onChange={(v) => setEdit({ ...edit, rows: { ...edit.rows, [h.id]: v } })} />
              </div>
            ))}
            <p className="text-sm text-slate-500">Leave an amount empty or 0 if the class is not charged for it.</p>
            <p className="text-sm text-slate-600">Yearly total: <b className="text-ink">{rupees(editYear)}</b></p>
            <Button type="submit" disabled={editYear <= 0} className="w-full">Save fee structure</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
