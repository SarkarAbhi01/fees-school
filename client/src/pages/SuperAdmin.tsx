import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rupees } from '../lib/api';
import { Badge, Button, ErrorText, Field, Input, Modal, Pager, Panel, Select, td } from '../components/ui';
import SortTh from '../components/SortTh';

export interface School {
  id: string; name: string; code: string; is_active: boolean; createdAt: string;
  address: string; city: string; state: string; pincode: string; mobile: string; email: string; contact_person: string;
  plan_type: string; plan_amount: number; plan_start: string | null; plan_end: string | null; plan_status: string;
  students: number; students_left: number; admin_email: string; disabled_menus: string[];
}
export const PLAN_LABEL: Record<string, string> = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', HALF_YEARLY: 'Half-yearly', YEARLY: 'Yearly' };
export const PLAN_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
const PS_STYLE: Record<string, string> = { ACTIVE: 'bg-good/10 text-good', EXPIRING: 'bg-late/10 text-late', EXPIRED: 'bg-bad/10 text-bad', NONE: 'bg-slate-200 text-slate-600' };
const PS_TEXT: Record<string, string> = { ACTIVE: 'Plan active', EXPIRING: 'Expiring soon', EXPIRED: 'Plan expired', NONE: 'No plan dates' };
export const PlanBadge = ({ status }: { status: string }) => <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${PS_STYLE[status]}`}>{PS_TEXT[status] ?? status}</span>;
export const fmtDate = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** End date = start + plan length (same rule as the server). */
export function planEnd(start: string, plan: string) {
  if (!start) return '';
  const [y, m, d] = start.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + PLAN_MONTHS[plan], d));
  if (t.getUTCDate() !== d) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}

export const emptySchool = () => ({
  schoolName: '', adminEmail: '', adminPassword: '', contact_person: '', mobile: '', email: '', address: '', city: '', state: '', pincode: '',
  plan_type: 'YEARLY', plan_amount: '', plan_start: new Date().toLocaleDateString('en-CA'), plan_end: '',
});

export function PlanFields({ v, set }: { v: { plan_type: string; plan_amount: string; plan_start: string; plan_end: string }; set: (p: Partial<typeof v>) => void }) {
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-semibold">Subscription plan</p>
      <div role="radiogroup" aria-label="Plan" className="grid grid-cols-2 overflow-hidden rounded-md border border-slate-300 sm:grid-cols-4">
        {Object.entries(PLAN_LABEL).map(([k, label]) => (
          <button type="button" key={k} role="radio" aria-checked={v.plan_type === k} onClick={() => set({ plan_type: k, plan_end: planEnd(v.plan_start, k) })}
            className={`h-10 px-2 text-sm font-semibold ${v.plan_type === k ? 'bg-board text-white' : 'bg-white hover:bg-board-50'}`}>{label}</button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Amount per ${PLAN_LABEL[v.plan_type].toLowerCase()} plan (₹)`}><Input type="number" min={0} value={v.plan_amount} onChange={(e) => set({ plan_amount: e.target.value })} /></Field>
        <Field label="Starts on"><Input type="date" value={v.plan_start} onChange={(e) => set({ plan_start: e.target.value, plan_end: planEnd(e.target.value, v.plan_type) })} /></Field>
        <Field label="Valid until"><Input type="date" value={v.plan_end} min={v.plan_start} onChange={(e) => set({ plan_end: e.target.value })} /></Field>
      </div>
    </div>
  );
}

export function ProfileFields({ v, set }: { v: Record<string, string>; set: (p: Record<string, string>) => void }) {
  const f = (k: string, label: string, type = 'text') => <Field label={label}><Input type={type} value={v[k] ?? ''} onChange={(e) => set({ [k]: e.target.value })} /></Field>;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">{f('contact_person', 'Principal / contact person')}{f('mobile', 'Mobile no.', 'tel')}</div>
      {f('email', 'School email', 'email')}
      <Field label="Address"><textarea value={v.address ?? ''} onChange={(e) => set({ address: e.target.value })} rows={2} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" /></Field>
      <div className="grid gap-3 sm:grid-cols-3">{f('city', 'City')}{f('state', 'State')}{f('pincode', 'Pincode')}</div>
    </>
  );
}

export default function SuperAdmin() {
  const [data, setData] = useState<{ data: School[]; total: number; states: string[]; cities: string[] } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(''); const [q, setQ] = useState('');
  const [status, setStatus] = useState(''); const [plan, setPlan] = useState(''); const [planStatus, setPlanStatus] = useState(''); const [state, setState] = useState('');
  const [sort, setSort] = useState('created'); const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptySchool());
  const [error, setError] = useState(''); const [formError, setFormError] = useState(''); const [created, setCreated] = useState('');

  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), limit: '25', search: q, status, plan_type: plan, plan_status: planStatus, state, sort, dir });
    try { setData(await api(`/api/superadmin/schools?${qs}`)); setError(''); } catch (e: any) { setError(e.message); }
  }, [page, q, status, plan, planStatus, state, sort, dir]);
  useEffect(() => { load(); }, [load]);

  const onSort = (k: string) => { if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir(k === 'name' || k === 'city' ? 'asc' : 'desc'); } setPage(1); };
  const filter = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setPage(1); };

  async function create(e: FormEvent) {
    e.preventDefault(); setFormError('');
    try {
      const r = await api<{ school: School }>('/api/superadmin/create-school', { body: { ...form, plan_amount: Number(form.plan_amount || 0), plan_end: form.plan_end || undefined } });
      setCreated(`${r.school.name} created with code ${r.school.code}. Admin can sign in with ${form.adminEmail}.`);
      setForm(emptySchool()); setAdding(false); setPage(1); load();
    } catch (err: any) { setFormError(err.message); }
  }
  async function toggle(id: string) { await api(`/api/superadmin/schools/${id}/toggle`, { method: 'PATCH' }); load(); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Schools</h1>
        <Button onClick={() => { setAdding(true); setFormError(''); }}>+ Add school</Button>
      </div>
      {created && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{created}</p>}
      <ErrorText>{error}</ErrorText>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, city, mobile, email" aria-label="Search" className="lg:col-span-2" />
        <Select value={status} onChange={filter(setStatus)} aria-label="Status"><option value="">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></Select>
        <Select value={plan} onChange={filter(setPlan)} aria-label="Plan"><option value="">All plans</option>{Object.entries(PLAN_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select value={planStatus} onChange={filter(setPlanStatus)} aria-label="Plan status"><option value="">Any plan status</option>{Object.entries(PS_TEXT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        {(data?.states.length ?? 0) > 0 && <Select value={state} onChange={filter(setState)} aria-label="State"><option value="">All states</option>{data!.states.map((s) => <option key={s}>{s}</option>)}</Select>}
      </div>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <SortTh label="School" k="name" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Code" k="code" sort={sort} dir={dir} onSort={onSort} />
                <SortTh label="City" k="city" sort={sort} dir={dir} onSort={onSort} /><th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Mobile</th>
                <SortTh label="Plan" k="plan" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Valid until" k="plan_end" sort={sort} dir={dir} onSort={onSort} />
                <SortTh label="Students" k="students" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Status" k="status" sort={sort} dir={dir} onSort={onSort} />
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Active</th><th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.data.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} font-medium`}><Link to={`/superadmin/schools/${s.id}`} className="text-board underline-offset-2 hover:underline">{s.name}</Link></td>
                  <td className={td}>{s.code}</td><td className={td}>{s.city || '—'}</td><td className={td}>{s.mobile || '—'}</td>
                  <td className={td}>{PLAN_LABEL[s.plan_type]}{s.plan_amount > 0 && <span className="block text-xs text-slate-500">{rupees(s.plan_amount)}</span>}</td>
                  <td className={td}>{fmtDate(s.plan_end)}<span className="mt-0.5 block"><PlanBadge status={s.plan_status} /></span></td>
                  <td className={td}>{s.students}</td>
                  <td className={td}><Badge kind={s.is_active ? 'ACTIVE' : 'INACTIVE'} /></td>
                  <td className={td}>
                    <button role="switch" aria-checked={s.is_active} aria-label={`Toggle ${s.name}`} onClick={() => toggle(s.id)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${s.is_active ? 'bg-board' : 'bg-slate-300'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${s.is_active ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className={td}><Link to={`/superadmin/schools/${s.id}`} className="inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-board-50">View / Edit</Link></td>
                </tr>
              ))}
              {data && data.data.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">No schools match. Change the filters or add a school.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={page} limit={25} total={data?.total ?? 0} onPage={setPage} />
      </Panel>

      {adding && (
        <Modal title="Add a school" wide onClose={() => setAdding(false)}>
          <form onSubmit={create} className="space-y-3">
            <ErrorText>{formError}</ErrorText>
            <Field label="School name"><Input required value={form.schoolName} onChange={(e) => setForm({ ...form, schoolName: e.target.value })} /></Field>
            <ProfileFields v={form as any} set={(p) => setForm({ ...form, ...p })} />
            <PlanFields v={form} set={(p) => setForm({ ...form, ...p })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Admin email (login)"><Input type="email" required value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} /></Field>
              <Field label="Admin password (min 6)"><Input type="text" required minLength={6} value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} /></Field>
            </div>
            <Button type="submit" className="w-full">Create school and admin</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
