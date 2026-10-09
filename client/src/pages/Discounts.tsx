import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, rupees } from '../lib/api';
import { Badge, Button, ErrorText, Field, Input, Modal, Panel, Select, td, th } from '../components/ui';

interface Head { id: string; name: string }
interface Discount { id: string; name: string; type: 'PERCENT' | 'FLAT'; value: number; head_id: string | null; is_active: boolean }
interface Assigned { id: string; name: string; type: string; value: number; is_active: boolean; assigned_by: string; createdAt: string }
interface StudentRes { student: { name: string; class: string; section: string; unique_no: string }; assigned: Assigned[] }
const blank = { name: '', type: 'PERCENT', value: '', head_id: '' };
const show = (type: string, value: number) => (type === 'PERCENT' ? `${value}%` : rupees(value));

export default function Discounts() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [heads, setHeads] = useState<Head[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blank);
  const [unique, setUnique] = useState('');
  const [stu, setStu] = useState<StudentRes | null>(null);
  const [pick, setPick] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, h] = await Promise.all([api<{ data: Discount[] }>('/api/fees/discounts'), api<{ data: Head[] }>('/api/fees/heads')]);
      setDiscounts(d.data); setHeads(h.data); setError('');
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const headName = (id: string | null) => (id ? heads.find((h) => h.id === id)?.name ?? '?' : 'All fee heads');

  async function create(e: FormEvent) {
    e.preventDefault(); setError('');
    try {
      await api('/api/fees/discounts', { body: { name: form.name, type: form.type, value: Number(form.value), head_id: form.head_id || null } });
      setAdding(false); setForm(blank); setNotice('Discount created. Assign it to students below.'); load();
    } catch (err: any) { setError(err.message); }
  }
  async function toggle(d: Discount) {
    try { await api(`/api/fees/discounts/${d.id}`, { method: 'PATCH', body: { is_active: !d.is_active } }); load(); } catch (err: any) { setError(err.message); }
  }

  async function lookup(q = unique) {
    if (!q.trim()) return;
    try { setStu(await api<StudentRes>(`/api/fees/discounts/student?unique_no=${encodeURIComponent(q.trim())}`)); setError(''); }
    catch (err: any) { setStu(null); setError(err.message); }
  }
  async function assign() {
    if (!stu || !pick) return;
    try { await api('/api/fees/discounts/assign', { body: { unique_no: stu.student.unique_no, discount_id: pick } }); setPick(''); setNotice('Discount assigned.'); lookup(stu.student.unique_no); }
    catch (err: any) { setError(err.message); }
  }
  async function unassign(id: string) {
    try { await api(`/api/fees/discounts/assign/${id}`, { method: 'DELETE' }); lookup(stu?.student.unique_no); } catch (err: any) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Discounts</h1>
        <Button onClick={() => setAdding(true)}>Create discount</Button>
      </div>
      <p className="text-sm text-slate-500">Admin discounts are set here and assigned to students. Collectors can also give a one-off “other” discount while collecting; both are tracked in Discount Report.</p>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{notice}</p>}

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className={th}>Discount</th><th className={th}>Value</th><th className={th}>Applies to</th><th className={th}>Status</th><th className={th}></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {discounts.map((d) => (
                <tr key={d.id}>
                  <td className={`${td} font-medium`}>{d.name}</td>
                  <td className={td}>{show(d.type, d.value)}{d.type === 'FLAT' ? ' / year' : ''}</td>
                  <td className={td}>{headName(d.head_id)}</td>
                  <td className={td}><Badge kind={d.is_active ? 'ACTIVE' : 'INACTIVE'} /></td>
                  <td className={td}><Button variant="outline" className="h-8 px-3" onClick={() => toggle(d)}>{d.is_active ? 'Deactivate' : 'Activate'}</Button></td>
                </tr>
              ))}
              {discounts.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No discounts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="space-y-4 p-5">
        <h2 className="font-bold">Assign a discount to a student</h2>
        <form onSubmit={(e) => { e.preventDefault(); lookup(); }} className="flex max-w-md gap-2">
          <Input value={unique} onChange={(e) => setUnique(e.target.value)} placeholder="Student unique no, e.g. STU-0001" aria-label="Unique no" />
          <Button type="submit" variant="outline">Find</Button>
        </form>
        {stu && (
          <div className="space-y-3">
            <p className="font-semibold">{stu.student.name} <span className="font-normal text-slate-600">· Class {stu.student.class}{stu.student.section ? `-${stu.student.section}` : ''} · {stu.student.unique_no}</span></p>
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {stu.assigned.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span><b>{a.name}</b> · {show(a.type, a.value)}{!a.is_active && ' (inactive)'} <span className="text-slate-500">· by {a.assigned_by}, {new Date(a.createdAt).toLocaleDateString('en-IN')}</span></span>
                  <Button variant="outline" className="h-8 px-3" onClick={() => unassign(a.id)}>Remove</Button>
                </li>
              ))}
              {stu.assigned.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No discount assigned.</li>}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Discount">
                <option value="">Choose discount…</option>
                {discounts.filter((d) => d.is_active && !stu.assigned.some((a) => a.name === d.name)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
              <Button disabled={!pick} onClick={assign}>Assign</Button>
            </div>
          </div>
        )}
      </Panel>

      {adding && (
        <Modal title="Create discount" onClose={() => setAdding(false)}>
          <form onSubmit={create} className="space-y-3">
            <Field label="Name"><Input required autoFocus maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sibling discount" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full">
                  <option value="PERCENT">Percent (%)</option><option value="FLAT">Flat amount (₹ per year)</option>
                </Select>
              </Field>
              <Field label={form.type === 'PERCENT' ? 'Percent' : 'Amount'}><Input required type="number" min={1} max={form.type === 'PERCENT' ? 100 : undefined} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
            </div>
            <Field label={form.type === 'FLAT' ? 'Fee head (required)' : 'Applies to'}>
              <Select required={form.type === 'FLAT'} value={form.head_id} onChange={(e) => setForm({ ...form, head_id: e.target.value })} className="w-full">
                {form.type === 'PERCENT' && <option value="">All fee heads</option>}
                {form.type === 'FLAT' && <option value="">Choose fee head…</option>}
                {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </Select>
            </Field>
            <Button type="submit" className="w-full">Save discount</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
