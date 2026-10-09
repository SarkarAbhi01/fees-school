import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, ErrorText, Field, Input, Modal, Pager, Panel, Select, td, th } from '../components/ui';

interface Student { id: string; unique_no: string; rfid_uid: string; name: string; class: string; section: string; parent_phone: string; uses_transport: boolean; admission_date: string | null; is_active: boolean }
interface ClassRow { class: string; active: number; left: number }
const blank = { name: '', class: '', section: '', parent_phone: '', rfid_uid: '', unique_no: '', uses_transport: false, admission_date: '' };

export default function Students() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SCHOOL_ADMIN';
  const [classes, setClasses] = useState<{ data: ClassRow[]; active: number; left: number }>({ data: [], active: 0, left: 0 });
  const [cls, setCls] = useState('');                 // '' = class-wise counts (no student list)
  const [status, setStatus] = useState<'active' | 'left' | 'all'>('active');
  const [rows, setRows] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<{ id: string; name: string; uses_transport: boolean; admission_date: string; is_active: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showList = !!cls || !!q; // the student list only opens after choosing a class (or searching)

  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const loadClasses = useCallback(async () => {
    try { setClasses(await api(`/api/students/classes`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { loadClasses(); }, [loadClasses]);

  const load = useCallback(async () => {
    if (!showList) { setRows([]); setTotal(0); return; }
    try {
      const r = await api<{ data: Student[]; total: number }>(`/api/students?class=${encodeURIComponent(cls)}&status=${status}&search=${encodeURIComponent(q)}&page=${page}&limit=50`);
      setRows(r.data); setTotal(r.total); setError('');
    } catch (e: any) { setError(e.message); }
  }, [cls, status, q, page, showList]);
  useEffect(() => { load(); }, [load]);

  const refresh = () => { load(); loadClasses(); };
  const pick = (c: string, s: 'active' | 'left' | 'all' = 'active') => { setCls(c); setStatus(s); setPage(1); };

  async function upload(file?: File) {
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    setNotice(''); setError('');
    try {
      const r = await api<any>('/api/students/bulk-upload', { form: fd });
      setNotice(`Read ${r.rows_read} rows: ${r.inserted} added, ${r.skipped_duplicates} already existed, ${r.invalid_rows} skipped.${(r.errors ?? []).length ? ` Row ${r.errors[0].row}: ${r.errors[0].message}${r.errors.length > 1 ? ` (and ${r.errors.length - 1} more)` : ''}` : ''}`);
      refresh();
    } catch (e: any) { setError(e.message); }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function add(e: FormEvent) {
    e.preventDefault(); setError('');
    try {
      await api('/api/students', { body: { ...form, unique_no: form.unique_no || undefined } });
      setAdding(false); setForm(blank); setNotice('Student added.'); refresh();
    } catch (err: any) { setError(err.message); }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault(); if (!editing) return; setError('');
    try {
      await api(`/api/students/${editing.id}`, { method: 'PATCH', body: { uses_transport: editing.uses_transport, admission_date: editing.admission_date, is_active: editing.is_active } });
      setEditing(null); setNotice('Student updated.'); refresh();
    } catch (err: any) { setError(err.message); }
  }

  const clsInfo = classes.data.find((c) => c.class === cls);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Students</h1>
        {canEdit && (
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => upload(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => downloadFile('/api/students/template.xlsx', 'Student_Template.xlsx').catch((e) => setError(e.message))}>Excel template</Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>Bulk upload Excel / CSV</Button>
            <Button onClick={() => { setForm({ ...blank, class: cls }); setAdding(true); }}>Add student</Button>
          </div>
        )}
      </div>
      {canEdit && <p className="text-sm text-slate-500">Download the Excel template, fill it (one student per row) and upload it. Columns: unique_no, rfid_uid, name, class, parent_phone (optional: section, uses_transport = Yes/No, admission_date). Leave unique_no empty to auto-generate. CSV files work too.</p>}
      <ErrorText>{error}</ErrorText>
      {notice && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{notice}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Select value={cls} onChange={(e) => pick(e.target.value)} aria-label="Class">
          <option value="">All classes (counts)</option>
          {classes.data.map((c) => <option key={c.class} value={c.class}>Class {c.class} ({c.active})</option>)}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value as 'active' | 'left' | 'all'); setPage(1); }} aria-label="Status">
          <option value="active">Studying</option><option value="left">Left school</option><option value="all">All</option>
        </Select>
        <Input placeholder="Search by name, unique no, RFID or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
      </div>

      {!showList && (
        <>
          <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2">
            <div className="bg-white p-5"><p className="text-sm text-slate-500">Students studying</p><p className="mt-1 font-display text-3xl font-bold text-board">{classes.active}</p></div>
            <div className="bg-white p-5"><p className="text-sm text-slate-500">Left school</p><p className="mt-1 font-display text-3xl font-bold text-slate-600">{classes.left}</p></div>
          </div>
          <Panel className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50"><tr><th className={th}>Class</th><th className={th}>Students</th><th className={th}>Left school</th><th className={th}></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {classes.data.map((c) => (
                    <tr key={c.class} className="hover:bg-board-50">
                      <td className={`${td} font-semibold`}>Class {c.class}</td>
                      <td className={td}>{c.active}</td>
                      <td className={td}>{c.left > 0 ? <button type="button" className="font-medium text-board underline" onClick={() => pick(c.class, 'left')}>{c.left}</button> : 0}</td>
                      <td className={td}><Button variant="outline" className="h-8 px-3" onClick={() => pick(c.class)}>View students</Button></td>
                    </tr>
                  ))}
                  {classes.data.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">No students yet. Upload a CSV or add one.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {showList && (
        <>
          {cls && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => { pick(''); setSearch(''); }}>← All classes</Button>
              <p className="text-sm text-slate-600"><b className="text-ink">Class {cls}</b> · {clsInfo?.active ?? 0} studying{clsInfo && clsInfo.left > 0 ? `, ${clsInfo.left} left school` : ''}</p>
            </div>
          )}
          <Panel className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50"><tr><th className={th}>Unique No (for fees)</th><th className={th}>RFID No (12-year card)</th><th className={th}>Name</th><th className={th}>Class</th><th className={th}>Phone</th><th className={th}>Transport</th><th className={th}>Admission (fee billing starts)</th><th className={th}>Status</th>{canEdit && <th className={th}></th>}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((s) => (
                    <tr key={s.id} className="hover:bg-board-50">
                      <td className={`${td} font-semibold`}>{s.unique_no}</td>
                      <td className={td}>{s.rfid_uid}</td>
                      <td className={td}>{s.name}</td>
                      <td className={td}>{s.class}{s.section ? `-${s.section}` : ''}</td>
                      <td className={td}>{s.parent_phone}</td>
                      <td className={td}>{s.uses_transport ? 'Yes' : 'No'}</td>
                      <td className={td}>{s.admission_date ? new Date(s.admission_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Start of year'}</td>
                      <td className={td}><Badge kind={s.is_active ? 'ACTIVE' : 'LEFT'} /></td>
                      {canEdit && <td className={td}><Button variant="outline" className="h-8 px-3" onClick={() => setEditing({ id: s.id, name: s.name, uses_transport: s.uses_transport, admission_date: s.admission_date ? s.admission_date.slice(0, 10) : '', is_active: s.is_active })}>Edit</Button></td>}
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">{q ? 'No student matches this search.' : status === 'left' ? 'No student has left this class.' : 'No students in this class.'}</td></tr>}
                </tbody>
              </table>
            </div>
            <Pager page={page} limit={50} total={total} onPage={setPage} />
          </Panel>
        </>
      )}

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <form onSubmit={saveEdit} className="space-y-3">
            <Field label="Admission date (fee billing starts from this month; empty = start of year)"><Input type="date" value={editing.admission_date} onChange={(e) => setEditing({ ...editing, admission_date: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={editing.uses_transport} onChange={(e) => setEditing({ ...editing, uses_transport: e.target.checked })} />
              Uses school transport
            </label>
            <label className="flex items-start gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" className="mt-1" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
              <span>Studying in this school<span className="block text-xs font-normal text-slate-500">Untick when the student has left. Fees can no longer be collected for them; old receipts stay.</span></span>
            </label>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </Modal>
      )}
      {adding && (
        <Modal title="Add student" onClose={() => setAdding(false)}>
          <form onSubmit={add} className="space-y-3">
            <Field label="Name"><Input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Class"><Input required value={form.class} onChange={(e) => setForm({ ...form, class: e.target.value })} /></Field>
              <Field label="Section"><Input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} /></Field>
            </div>
            <Field label="Parent phone"><Input required value={form.parent_phone} onChange={(e) => setForm({ ...form, parent_phone: e.target.value })} /></Field>
            <Field label="RFID card number"><Input required value={form.rfid_uid} onChange={(e) => setForm({ ...form, rfid_uid: e.target.value })} /></Field>
            <Field label="Unique no (leave empty to auto-generate)"><Input value={form.unique_no} onChange={(e) => setForm({ ...form, unique_no: e.target.value })} /></Field>
            <Field label="Admission date (fee billing starts from this month; empty = start of year)"><Input type="date" value={form.admission_date} onChange={(e) => setForm({ ...form, admission_date: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={form.uses_transport} onChange={(e) => setForm({ ...form, uses_transport: e.target.checked })} />
              Uses school transport (transport fee applies)
            </label>
            <Button type="submit" className="w-full">Save student</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
