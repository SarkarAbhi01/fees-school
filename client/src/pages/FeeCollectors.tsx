import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button, ErrorText, Field, Input, Modal, Panel, td, th } from '../components/ui';

interface Collector { id: string; name: string; email: string; createdAt: string }
const blank = { name: '', email: '', password: '' };

export default function FeeCollectors() {
  const [rows, setRows] = useState<Collector[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blank);

  const load = useCallback(async () => {
    try { setRows((await api<{ data: Collector[] }>('/api/fees/collectors')).data); setError(''); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await api('/api/fees/collectors', { body: form }); setAdding(false); setForm(blank); setNotice('Fee collector added. They can sign in and see only the Fees module.'); load(); }
    catch (err: any) { setError(err.message); }
  }
  async function remove(c: Collector) {
    if (!window.confirm(`Remove ${c.name}?`)) return;
    try { await api(`/api/fees/collectors/${c.id}`, { method: 'DELETE' }); load(); } catch (err: any) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Fee Collectors</h1>
        <Button onClick={() => setAdding(true)}>Add collector</Button>
      </div>
      <p className="text-sm text-slate-500">Fee collectors can only open the Fees module (collect fees and view the fee structure).</p>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{notice}</p>}
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className={th}>Name</th><th className={th}>Email</th><th className={th}>Added</th><th className={th}></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className={`${td} font-medium`}>{c.name}</td><td className={td}>{c.email}</td>
                  <td className={td}>{new Date(c.createdAt).toLocaleDateString('en-IN')}</td>
                  <td className={td}><Button variant="outline" className="h-8 px-3" onClick={() => remove(c)}>Remove</Button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">No fee collectors yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      {adding && (
        <Modal title="Add fee collector" onClose={() => setAdding(false)}>
          <form onSubmit={add} className="space-y-3">
            <Field label="Name"><Input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Password (min 6 characters)"><Input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Button type="submit" className="w-full">Save collector</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
