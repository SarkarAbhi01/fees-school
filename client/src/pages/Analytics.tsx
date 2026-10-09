import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadCsv, downloadFile, rupees, todayStr } from '../lib/api';
import { Badge, Button, ErrorText, Input, Panel, Select, td, th } from '../components/ui';
import SortTh from '../components/SortTh';
import { BarChart, HBars, Stat } from '../components/Charts';
import { PLAN_LABEL, PlanBadge, fmtDate } from './SuperAdmin';

interface Row {
  id: string; name: string; code: string; city: string; state: string; mobile: string; is_active: boolean; plan_type: string; plan_amount: number; plan_end: string | null; plan_status: string;
  students: number; students_left: number; collected: number; receipts: number; payers: number; discount: number; avg_per_student: number;
  attendance_pct: number; days_open: number; last_payment: string | null;
}
interface Res {
  range: { from: string; to: string };
  totals: Record<string, number>; groups: { key: string; schools: number; students: number; collected: number; receipts: number; attendance_pct: number }[];
  schools: Row[]; states: string[]; cities: string[];
  series: { collection_by_day: { date: string; collected: number; receipts: number }[]; attendance_by_day: { date: string; present: number }[]; schools_by_month: { month: string; schools: number }[] };
}
const PERIODS: [string, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['last30', 'Last 30 days'], ['fy', 'This financial year'], ['custom', 'Custom']];
const GROUPS: [string, string][] = [['none', 'No grouping'], ['state', 'By state'], ['city', 'By city'], ['plan_type', 'By plan'], ['plan_status', 'By plan status']];

export default function Analytics() {
  const [period, setPeriod] = useState('month');
  const [from, setFrom] = useState(todayStr()); const [to, setTo] = useState(todayStr());
  const [search, setSearch] = useState(''); const [q, setQ] = useState('');
  const [status, setStatus] = useState(''); const [plan, setPlan] = useState(''); const [planStatus, setPlanStatus] = useState(''); const [state, setState] = useState(''); const [city, setCity] = useState('');
  const [group, setGroup] = useState('none');
  const [sort, setSort] = useState('collected'); const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [res, setRes] = useState<Res | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  const qs = useMemo(() => new URLSearchParams({ period, ...(period === 'custom' ? { from, to } : {}), search: q, status, plan_type: plan, plan_status: planStatus, state, city, sort, dir, group }).toString(), [period, from, to, q, status, plan, planStatus, state, city, sort, dir, group]);
  const load = useCallback(async () => {
    try { setRes(await api<Res>(`/api/superadmin/analytics?${qs}`)); setError(''); } catch (e: any) { setError(e.message); }
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  const onSort = (k: string) => { if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir(k === 'name' || k === 'city' ? 'asc' : 'desc'); } };
  const t = res?.totals ?? {};
  const top = (res?.schools ?? []).slice(0, 8);
  const reset = () => { setSearch(''); setStatus(''); setPlan(''); setPlanStatus(''); setState(''); setCity(''); setGroup('none'); setPeriod('month'); };

  const xlsx = async () => { setBusy(true); try { await downloadFile(`/api/superadmin/analytics.xlsx?${qs}`, 'School_Analytics.xlsx'); } catch (e: any) { setError(e.message); } setBusy(false); };
  const csv = () => res && downloadCsv(`School_Analytics_${res.range.from}_${res.range.to}.csv`,
    ['School', 'Code', 'City', 'State', 'Status', 'Plan', 'Plan end', 'Students', 'Collected', 'Receipts', 'Attendance %', 'Last payment'],
    res.schools.map((s) => [s.name, s.code, s.city, s.state, s.is_active ? 'Active' : 'Inactive', s.plan_type, s.plan_end, s.students, s.collected, s.receipts, s.attendance_pct, s.last_payment?.slice(0, 10)]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">School Analytics</h1><p className="text-sm text-slate-500">{res ? `${fmtDate(res.range.from)} to ${fmtDate(res.range.to)} · ${t.schools ?? 0} schools` : 'Loading…'}</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={csv} disabled={!res}>Download CSV</Button><Button variant="outline" onClick={xlsx} disabled={busy}>Download Excel</Button></div>
      </div>
      <ErrorText>{error}</ErrorText>

      <Panel className="space-y-3 p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          {period === 'custom' && <><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><Input type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} aria-label="To" /></>}
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search school, code, city, mobile" aria-label="Search" className={period === 'custom' ? '' : 'lg:col-span-3'} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></Select>
          <Select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan"><option value="">All plans</option>{Object.entries(PLAN_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Select value={planStatus} onChange={(e) => setPlanStatus(e.target.value)} aria-label="Plan status"><option value="">Any plan status</option><option value="ACTIVE">Plan active</option><option value="EXPIRING">Expiring in 30 days</option><option value="EXPIRED">Plan expired</option><option value="NONE">No plan dates</option></Select>
          <Select value={state} onChange={(e) => setState(e.target.value)} aria-label="State"><option value="">All states</option>{res?.states.map((s) => <option key={s}>{s}</option>)}</Select>
          <Select value={city} onChange={(e) => setCity(e.target.value)} aria-label="City"><option value="">All cities</option>{res?.cities.map((s) => <option key={s}>{s}</option>)}</Select>
          <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </div>
        <button type="button" onClick={reset} className="text-sm font-semibold text-board">Clear all filters</button>
      </Panel>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 lg:grid-cols-4">
        <Stat label="Schools" value={t.schools ?? 0} hint={`${t.active_schools ?? 0} active · ${t.inactive_schools ?? 0} inactive`} />
        <Stat label="Students" value={t.students ?? 0} hint={`${t.students_left ?? 0} left school`} />
        <Stat label="Fees collected" value={rupees(t.collected ?? 0)} tone="text-board" hint={`${t.receipts ?? 0} receipts`} />
        <Stat label="Attendance" value={`${t.attendance_pct ?? 0}%`} tone="text-good" hint="present marks ÷ (students × days open)" />
        <Stat label="Plan income / month" value={rupees(t.plan_revenue_monthly ?? 0)} hint={`${rupees(t.plan_revenue_yearly ?? 0)} a year`} />
        <Stat label="Plans expiring (30 days)" value={t.expiring ?? 0} tone="text-late" />
        <Stat label="Plans expired" value={t.expired ?? 0} tone="text-bad" />
        <Stat label="Discount given" value={rupees(t.discount ?? 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel><h2 className="border-b border-slate-200 px-4 py-3 font-bold">Collection by day</h2><div className="p-3"><BarChart data={(res?.series.collection_by_day ?? []).map((d) => ({ label: d.date.slice(5), value: d.collected, sub: `${d.receipts} receipts` }))} format={rupees} /></div></Panel>
        <Panel><h2 className="border-b border-slate-200 px-4 py-3 font-bold">Students present by day</h2><div className="p-3"><BarChart color="#1B7F4B" data={(res?.series.attendance_by_day ?? []).map((d) => ({ label: d.date.slice(5), value: d.present }))} /></div></Panel>
        <Panel><h2 className="border-b border-slate-200 px-4 py-3 font-bold">Top schools by collection</h2><HBars data={top.map((s) => ({ label: s.name, value: s.collected }))} format={rupees} /></Panel>
        <Panel><h2 className="border-b border-slate-200 px-4 py-3 font-bold">Biggest schools by students</h2><HBars color="#B7791F" data={[...(res?.schools ?? [])].sort((a, b) => b.students - a.students).slice(0, 8).map((s) => ({ label: s.name, value: s.students }))} /></Panel>
      </div>

      {res && res.groups.length > 0 && (
        <Panel className="overflow-hidden">
          <h2 className="border-b border-slate-200 px-4 py-3 font-bold">{GROUPS.find(([k]) => k === group)?.[1]}</h2>
          <div className="overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className={th}>Group</th><th className={th}>Schools</th><th className={th}>Students</th><th className={th}>Collected</th><th className={th}>Receipts</th><th className={th}>Attendance</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{res.groups.map((g) => <tr key={g.key}><td className={`${td} font-semibold`}>{PLAN_LABEL[g.key] ?? g.key}</td><td className={td}>{g.schools}</td><td className={td}>{g.students}</td><td className={`${td} font-semibold`}>{rupees(g.collected)}</td><td className={td}>{g.receipts}</td><td className={td}>{g.attendance_pct}%</td></tr>)}</tbody></table></div>
        </Panel>
      )}

      <Panel className="overflow-hidden">
        <h2 className="border-b border-slate-200 px-4 py-3 font-bold">School-wise report</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50"><tr>
              <SortTh label="School" k="name" sort={sort} dir={dir} onSort={onSort} /><SortTh label="City" k="city" sort={sort} dir={dir} onSort={onSort} />
              <SortTh label="Plan" k="plan" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Valid until" k="plan_end" sort={sort} dir={dir} onSort={onSort} />
              <SortTh label="Students" k="students" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Collected" k="collected" sort={sort} dir={dir} onSort={onSort} />
              <SortTh label="Receipts" k="receipts" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Paid students" k="payers" sort={sort} dir={dir} onSort={onSort} />
              <SortTh label="Per student" k="avg" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Attendance" k="attendance" sort={sort} dir={dir} onSort={onSort} />
              <SortTh label="Last payment" k="last_payment" sort={sort} dir={dir} onSort={onSort} /><th className={th}>Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {res?.schools.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} font-medium`}><Link to={`/superadmin/schools/${s.id}`} className="text-board hover:underline">{s.name}</Link><span className="block text-xs font-normal text-slate-500">{s.code}</span></td>
                  <td className={td}>{s.city || '—'}</td><td className={td}>{PLAN_LABEL[s.plan_type]}</td>
                  <td className={td}>{fmtDate(s.plan_end)} <PlanBadge status={s.plan_status} /></td>
                  <td className={td}>{s.students}</td><td className={`${td} font-semibold`}>{rupees(s.collected)}</td><td className={td}>{s.receipts}</td><td className={td}>{s.payers}</td>
                  <td className={td}>{rupees(s.avg_per_student)}</td>
                  <td className={td}>{s.days_open ? `${s.attendance_pct}%` : '—'}</td>
                  <td className={td}>{s.last_payment ? fmtDate(s.last_payment.slice(0, 10)) : '—'}</td>
                  <td className={td}><Badge kind={s.is_active ? 'ACTIVE' : 'INACTIVE'} /></td>
                </tr>
              ))}
              {res && res.schools.length === 0 && <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-slate-500">No schools match these filters.</td></tr>}
              {res && res.schools.length > 0 && (
                <tr className="bg-slate-50 font-bold"><td className={td}>Total</td><td className={td}></td><td className={td}></td><td className={td}></td><td className={td}>{t.students}</td><td className={td}>{rupees(t.collected ?? 0)}</td><td className={td}>{t.receipts}</td><td className={td}></td><td className={td}></td><td className={td}>{t.attendance_pct}%</td><td className={td}></td><td className={td}></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
