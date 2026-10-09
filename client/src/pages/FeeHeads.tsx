import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, ErrorText, Field, Input, Modal, Panel, td, th } from '../components/ui';

interface Head { id: string; name: string; transport_only: boolean; is_active: boolean }
const DEFAULTS: [string, boolean][] = [['Tuition fee', false], ['Transport fee', true], ['Library fee', false], ['Exam fee', false]];

export default function FeeHeads() {
  const [rows, setRows] = useState<Head[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', transport_only: false });

  const load = useCallback(async () => {
    try { setRows((await api<{ data: Head[] }>('/api/fees/heads')).data); setError(''); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await api('/api/fees/heads', { body: form }); setAdding(false); setForm({ name: '', transport_only: false }); setNotice('Fee head added. Set its amounts in Fee Structure.'); load(); }
    catch (err: any) { setError(err.message); }
  }
  async function addDefaults() {
    setError('');
    for (const [name, transport_only] of DEFAULTS) {
      if (rows.some((r) => r.name.toLowerCase() === name.toLowerCase())) continue;
      try { await api('/api/fees/heads', { body: { name, transport_only } }); } catch (err: any) { setError(err.message); }
    }
    setNotice('Default fee heads added.'); load();
  }
  async function patch(id: string, body: object) {
    try { await api(`/api/fees/heads/${id}`, { method: 'PATCH', body }); load(); } catch (err: any) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Fee Heads</h1>
        <div className="flex gap-2">
          {rows.length === 0 && <Button variant="outline" onClick={addDefaults}>Add default heads</Button>}
          <Button onClick={() => setAdding(true)}>Add fee head</Button>
        </div>
      </div>
      <p className="text-sm text-slate-500">Create the kinds of fee your school charges (tuition, transport, library, exam, lab…). Amounts per class are set in Fee Structure.</p>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{notice}</p>}
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className={th}>Fee head</th><th className={th}>Charged to</th><th className={th}>Status</th><th className={th}></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((h) => (
                <tr key={h.id}>
                  <td className={`${td} font-medium`}>{h.name}</td>
                  <td className={td}>{h.transport_only ? 'Students using transport only' : 'All students'}</td>
                  <td className={td}><Badge kind={h.is_active ? 'ACTIVE' : 'INACTIVE'} /></td>
                  <td className={td}>
                    <div className="flex gap-2">
                      <Button variant="outline" className="h-8 px-3" onClick={() => patch(h.id, { is_active: !h.is_active })}>{h.is_active ? 'Deactivate' : 'Activate'}</Button>
                      <Button variant="outline" className="h-8 px-3" onClick={() => patch(h.id, { transport_only: !h.transport_only })}>{h.transport_only ? 'Make for all' : 'Transport only'}</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">No fee heads yet. Add one, or use “Add default heads”.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      {adding && (
        <Modal title="Add fee head" onClose={() => setAdding(false)}>
          <form onSubmit={add} className="space-y-3">
            <Field label="Fee head name"><Input required autoFocus maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Exam fee" /></Field>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={form.transport_only} onChange={(e) => setForm({ ...form, transport_only: e.target.checked })} />
              Charge only students who use school transport
            </label>
            <Button type="submit" className="w-full">Save fee head</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
