import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, ErrorText, Field, Input, Panel, td, th } from '../components/ui';
import FeeAmountInput from '../components/FeeAmountInput';
import { FeeInput, FeePeriod, Inst, describeFee, toInput, toPayload } from '../lib/feePeriods';

interface HeadRow { head_id: string; name: string; transport_only: boolean; class_amount: number | null; class_period: FeePeriod | null; class_installments: Inst[] | null; custom_amount: number | null; custom_period: FeePeriod; custom_installments: Inst[] | null }
interface Res { student: { name: string; class: string; section: string; unique_no: string; uses_transport: boolean; is_active: boolean }; heads: HeadRow[]; note: string; set_by: string | null }
interface ListRow { id: string; student: string; unique_no: string; class: string; is_active: boolean; head: string; amount: number; period: FeePeriod; installments: Inst[] | null; note: string; set_by: string; date: string }

const per = (a: number | null, p: FeePeriod | null, inst?: Inst[] | null) => (a === null || !p ? 'Not set' : describeFee(p, a, inst));

export default function CustomFees() {
  const [unique, setUnique] = useState('');
  const [res, setRes] = useState<Res | null>(null);
  const [rows, setRows] = useState<Record<string, FeeInput>>({});
  const [note, setNote] = useState('');
  const [list, setList] = useState<ListRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadList = useCallback(async () => {
    try { setList((await api<{ data: ListRow[] }>('/api/fees/custom/list')).data); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  async function lookup(q = unique) {
    if (!q.trim()) return;
    setNotice('');
    try {
      const r = await api<Res>(`/api/fees/custom/student?unique_no=${encodeURIComponent(q.trim())}`);
      setRes(r); setUnique(r.student.unique_no); setNote(r.note); setError('');
      setRows(Object.fromEntries(r.heads.map((h) => [h.head_id, h.custom_amount === null ? { ...toInput(h.custom_period, null), installments: [] } : toInput(h.custom_period, h.custom_amount, h.custom_installments)])));
    } catch (e: any) { setRes(null); setError(e.message); }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!res) return;
    setError('');
    try {
      await api(`/api/fees/custom/student/${encodeURIComponent(res.student.unique_no)}`, {
        method: 'PUT',
        body: { note, items: res.heads.map((h) => ({ head_id: h.head_id, ...toPayload(rows[h.head_id]) })) },
      });
      setNotice(`Custom fees saved for ${res.student.name}. The Collect Fee screen now uses them.`);
      lookup(res.student.unique_no); loadList();
    } catch (err: any) { setError(err.message); }
  }

  const anyCustom = Object.values(rows).some((r) => (r.period === 'CUSTOM' ? r.installments.length > 0 : r.amount !== ''));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Custom Fees</h1>
      <p className="text-sm text-slate-500">Special fees for individual students (scholarship, staff child, concession…). A custom amount replaces the class fee for that student only. Leave it empty to follow the class fee, or enter 0 to exempt the student from that fee.</p>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{notice}</p>}

      <Panel className="space-y-4 p-5">
        <form onSubmit={(e) => { e.preventDefault(); lookup(); }} className="flex max-w-md gap-2">
          <Input value={unique} onChange={(e) => setUnique(e.target.value)} placeholder="Student unique no, e.g. STU-0001" aria-label="Unique no" autoFocus />
          <Button type="submit" variant="outline">Find</Button>
        </form>

        {res && (
          <form onSubmit={save} className="space-y-4">
            <p className="font-semibold">
              {res.student.name} <span className="font-normal text-slate-600">· Class {res.student.class}{res.student.section ? `-${res.student.section}` : ''} · {res.student.unique_no}{res.student.uses_transport ? ' · Transport' : ''}</span>
              {!res.student.is_active && <> <Badge kind="LEFT" /></>}
            </p>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full">
                <thead className="bg-slate-50"><tr><th className={th}>Fee</th><th className={th}>Class fee</th><th className={th}>Custom fee for this student</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {res.heads.map((h) => (
                    <tr key={h.head_id}>
                      <td className={`${td} font-medium`}>{h.name}{h.transport_only && <span className="text-xs font-normal text-slate-500"> (transport students)</span>}</td>
                      <td className={td}>{per(h.class_amount, h.class_period, h.class_installments)}</td>
                      <td className={td}>
                        <FeeAmountInput name={h.name} placeholder="Class fee" value={rows[h.head_id] ?? toInput(null, null)} onChange={(v) => setRows({ ...rows, [h.head_id]: v })} />
                      </td>
                    </tr>
                  ))}
                  {res.heads.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">No fee heads yet. Create them in Fee Heads first.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="max-w-md">
              <Field label={`Reason for custom fee${anyCustom ? ' (required)' : ''}`}>
                <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Staff child, merit scholarship" />
              </Field>
            </div>
            {res.set_by && <p className="text-xs text-slate-500">Last set by {res.set_by}.</p>}
            <Button type="submit" disabled={res.heads.length === 0}>Save custom fees</Button>
          </form>
        )}
      </Panel>

      <Panel className="overflow-hidden">
        <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Students with custom fees</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className={th}>Student</th><th className={th}>Class</th><th className={th}>Fee</th><th className={th}>Custom fee</th><th className={th}>Reason</th><th className={th}>Set by</th><th className={th}>Date</th><th className={th}></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((r) => (
                <tr key={r.id}>
                  <td className={td}><span className="font-medium">{r.student}</span> <span className="text-slate-500">{r.unique_no}</span>{!r.is_active && <> <Badge kind="LEFT" /></>}</td>
                  <td className={td}>{r.class}</td><td className={td}>{r.head}</td>
                  <td className={`${td} font-semibold`}>{r.amount === 0 ? 'Exempt' : per(r.amount, r.period, r.installments)}</td>
                  <td className={td}>{r.note}</td><td className={td}>{r.set_by}</td><td className={td}>{new Date(r.date).toLocaleDateString('en-IN')}</td>
                  <td className={td}><Button variant="outline" className="h-8 px-3" onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); lookup(r.unique_no); }}>Edit</Button></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">No student has a custom fee yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
