import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, rupees } from '../lib/api';
import { MENU_DEFS } from '../lib/menus';
import { Badge, Button, ErrorText, Field, Input, Panel, Select, td, th } from '../components/ui';
import { BarChart, HBars, Stat } from '../components/Charts';
import { PLAN_LABEL, PlanBadge, PlanFields, ProfileFields, School, fmtDate } from './SuperAdmin';

interface Detail { school: School & { admins: { id: string; name: string; email: string }[]; users: { role: string; count: number }[]; fee_due_day: number; late_fee_amount: number } }
interface An {
  range: { from: string; to: string }; totals: { collected: number; receipts: number; payers: number; present_today: number };
  students_by_class: { class: string; active: number; left: number }[]; by_month: { month: string; collected: number; receipts: number }[];
  by_mode: { mode: string; collected: number; receipts: number }[]; by_head: { head: string; collected: number }[]; attendance_by_day: { date: string; present: number; late: number }[];
}
type Tab = 'view' | 'edit' | 'menus';

export default function SchoolDetail() {
  const { id } = useParams();
  const [d, setD] = useState<Detail | null>(null);
  const [an, setAn] = useState<An | null>(null);
  const [tab, setTab] = useState<Tab>('view');
  const [error, setError] = useState(''); const [ok, setOk] = useState('');
  const [form, setForm] = useState<Record<string, any>>({});
  const [off, setOff] = useState<string[]>([]);
  const [pw, setPw] = useState('');
  const [days, setDays] = useState('last30');

  const load = useCallback(async () => {
    try {
      const r = await api<Detail>(`/api/superadmin/schools/${id}`);
      setD(r); setOff(r.school.disabled_menus);
      const s = r.school;
      setForm({ name: s.name, contact_person: s.contact_person, mobile: s.mobile, email: s.email, address: s.address, city: s.city, state: s.state, pincode: s.pincode, plan_type: s.plan_type, plan_amount: String(s.plan_amount), plan_start: s.plan_start ?? '', plan_end: s.plan_end ?? '' });
    } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<An>(`/api/superadmin/schools/${id}/analytics?period=${days}`).then(setAn).catch(() => setAn(null)); }, [id, days]);

  const done = (m: string) => { setOk(m); setError(''); setTimeout(() => setOk(''), 4000); };
  async function save(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await api(`/api/superadmin/schools/${id}`, { method: 'PATCH', body: { ...form, plan_amount: Number(form.plan_amount || 0), plan_end: form.plan_end } }); await load(); done('School saved.'); setTab('view'); }
    catch (err: any) { setError(err.message); }
  }
  async function saveMenus() {
    try { await api(`/api/superadmin/schools/${id}/menus`, { method: 'PUT', body: { disabled: off } }); await load(); done('Menus saved. The school sees the change within a couple of minutes (or when they reopen the page).'); }
    catch (err: any) { setError(err.message); }
  }
  async function resetPw() {
    try { await api(`/api/superadmin/schools/${id}/admin-password`, { body: { password: pw } }); setPw(''); done('Admin password changed.'); } catch (err: any) { setError(err.message); }
  }
  async function toggleActive() { await api(`/api/superadmin/schools/${id}/toggle`, { method: 'PATCH' }); load(); }

  // switching a whole section off switches its sub menus off with it (they stay listed, greyed out)
  const flip = (key: string, on: boolean) => setOff((o) => (on ? o.filter((k) => k !== key) : [...new Set([...o, key])]));
  const s = d?.school;

  const tabBtn = (t: Tab, label: string) => (
    <button type="button" onClick={() => setTab(t)} className={`h-10 flex-1 px-4 text-sm font-semibold sm:flex-none ${tab === t ? 'bg-board text-white' : 'bg-white hover:bg-board-50'}`}>{label}</button>
  );
  const fmtMonth = (m: string) => { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }); };

  return (
    <div className="space-y-4">
      <Link to="/superadmin" className="text-sm font-semibold text-board">← All schools</Link>
      <ErrorText>{error}</ErrorText>
      {ok && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{ok}</p>}
      {!s ? <p className="text-slate-500">Loading…</p> : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{s.name}</h1>
              <p className="text-sm text-slate-500">Code {s.code} · added {fmtDate(s.createdAt.slice(0, 10))}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge kind={s.is_active ? 'ACTIVE' : 'INACTIVE'} /><PlanBadge status={s.plan_status} />
              <Button variant="outline" onClick={toggleActive}>{s.is_active ? 'Deactivate school' : 'Activate school'}</Button>
              <Link to={`/superadmin/backup?school=${s.id}`} className="inline-flex h-10 items-center rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-board-50">Backup</Link>
            </div>
          </div>

          <div className="flex overflow-hidden rounded-md border border-slate-300 sm:inline-flex">{tabBtn('view', 'View')}{tabBtn('edit', 'Edit & plan')}{tabBtn('menus', 'Menus on / off')}</div>

          {tab === 'view' && (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel className="p-4 sm:p-5">
                  <h2 className="mb-3 font-bold">School details</h2>
                  <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
                    <dt className="text-slate-500">Contact</dt><dd>{s.contact_person || '—'}</dd>
                    <dt className="text-slate-500">Mobile</dt><dd>{s.mobile ? <a className="text-board" href={`tel:${s.mobile}`}>{s.mobile}</a> : '—'}</dd>
                    <dt className="text-slate-500">Email</dt><dd className="break-all">{s.email || '—'}</dd>
                    <dt className="text-slate-500">Address</dt><dd>{[s.address, s.city, s.state, s.pincode].filter(Boolean).join(', ') || '—'}</dd>
                    <dt className="text-slate-500">Admin login</dt><dd className="break-all">{s.admins.map((a) => a.email).join(', ') || '—'}</dd>
                    <dt className="text-slate-500">Fee last date</dt><dd>{s.fee_due_day}th of the month{s.late_fee_amount > 0 ? ` · late fee ${rupees(s.late_fee_amount)}` : ' · no late fee'}</dd>
                  </dl>
                </Panel>
                <Panel className="p-4 sm:p-5">
                  <h2 className="mb-3 font-bold">Subscription</h2>
                  <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
                    <dt className="text-slate-500">Plan</dt><dd className="font-semibold">{PLAN_LABEL[s.plan_type]}</dd>
                    <dt className="text-slate-500">Amount</dt><dd>{rupees(s.plan_amount)} per {PLAN_LABEL[s.plan_type].toLowerCase()} plan</dd>
                    <dt className="text-slate-500">Starts</dt><dd>{fmtDate(s.plan_start)}</dd>
                    <dt className="text-slate-500">Valid until</dt><dd>{fmtDate(s.plan_end)} <PlanBadge status={s.plan_status} /></dd>
                    <dt className="text-slate-500">Students</dt><dd>{s.students} studying · {s.students_left} left school</dd>
                    <dt className="text-slate-500">Menus off</dt><dd>{s.disabled_menus.length ? s.disabled_menus.length : 'None'}</dd>
                  </dl>
                </Panel>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Analytics</h2>
                <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
                  <option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="last30">Last 30 days</option><option value="fy">This financial year</option>
                </Select>
              </div>
              <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 grid-cols-2 lg:grid-cols-4">
                <Stat label="Fees collected" value={rupees(an?.totals.collected ?? 0)} tone="text-board" />
                <Stat label="Receipts" value={an?.totals.receipts ?? 0} />
                <Stat label="Students who paid" value={an?.totals.payers ?? 0} />
                <Stat label="Present today" value={an?.totals.present_today ?? 0} tone="text-good" />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel><h3 className="border-b border-slate-200 px-4 py-3 font-bold">Collection, last 12 months</h3><div className="p-3"><BarChart data={(an?.by_month ?? []).map((m) => ({ label: fmtMonth(m.month), value: m.collected, sub: `${m.receipts} receipts` }))} format={rupees} /></div></Panel>
                <Panel><h3 className="border-b border-slate-200 px-4 py-3 font-bold">Students present each day</h3><div className="p-3"><BarChart color="#1B7F4B" data={(an?.attendance_by_day ?? []).map((a) => ({ label: a.date.slice(5), value: a.present, sub: `${a.late} late` }))} /></div></Panel>
                <Panel><h3 className="border-b border-slate-200 px-4 py-3 font-bold">Fee-wise</h3><HBars data={(an?.by_head ?? []).map((h) => ({ label: h.head, value: h.collected }))} format={rupees} /></Panel>
                <Panel><h3 className="border-b border-slate-200 px-4 py-3 font-bold">Payment mode</h3><HBars color="#B7791F" data={(an?.by_mode ?? []).map((m) => ({ label: `${m.mode} (${m.receipts})`, value: m.collected }))} format={rupees} /></Panel>
              </div>
              <Panel className="overflow-hidden">
                <h3 className="border-b border-slate-200 px-4 py-3 font-bold">Students by class</h3>
                <div className="overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className={th}>Class</th><th className={th}>Studying</th><th className={th}>Left school</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {an?.students_by_class.map((c) => <tr key={c.class}><td className={`${td} font-semibold`}>Class {c.class}</td><td className={td}>{c.active}</td><td className={td}>{c.left}</td></tr>)}
                    {an && an.students_by_class.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">No students yet.</td></tr>}
                  </tbody></table></div>
              </Panel>
            </>
          )}

          {tab === 'edit' && (
            <Panel className="max-w-3xl p-4 sm:p-6">
              <form onSubmit={save} className="space-y-3">
                <Field label="School name"><Input required value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <ProfileFields v={form} set={(p) => setForm({ ...form, ...p })} />
                <PlanFields v={form as any} set={(p) => setForm({ ...form, ...p })} />
                <div className="flex gap-2"><Button type="submit">Save changes</Button><Button type="button" variant="outline" onClick={() => { load(); setTab('view'); }}>Cancel</Button></div>
              </form>
              <div className="mt-6 border-t border-slate-200 pt-4">
                <p className="mb-2 text-sm font-semibold">Reset the school admin's password</p>
                <div className="flex flex-wrap gap-2"><Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 6)" className="max-w-xs" /><Button variant="outline" disabled={pw.length < 6} onClick={resetPw}>Change password</Button></div>
              </div>
            </Panel>
          )}

          {tab === 'menus' && (
            <Panel className="max-w-2xl p-4 sm:p-6">
              <p className="mb-1 text-sm text-slate-600">Switch a menu off to hide it from this school's navigation. Nothing else changes: their data, reports and the other screens keep working, and the owner can still use every feature that stays on.</p>
              <p className="mb-4 text-sm text-slate-500">Turning a whole section off (Fees) hides all its sub menus too.</p>
              <ul className="divide-y divide-slate-100">
                {MENU_DEFS.map((m) => {
                  const parentOff = !!m.parent && off.includes(m.parent);
                  const on = !off.includes(m.key) && !parentOff;
                  return (
                    <li key={m.key} className={`flex items-center justify-between gap-3 py-2.5 ${m.parent ? 'pl-5 sm:pl-8' : ''}`}>
                      <span className={`text-sm ${m.parent ? '' : 'font-semibold'} ${parentOff ? 'text-slate-400' : ''}`}>{m.label}</span>
                      <button role="switch" aria-checked={on} aria-label={m.label} disabled={parentOff} onClick={() => flip(m.key, !on)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-board' : 'bg-slate-300'}`}>
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex gap-2"><Button onClick={saveMenus}>Save menus</Button><Button variant="outline" onClick={() => setOff(s.disabled_menus)}>Undo</Button></div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
