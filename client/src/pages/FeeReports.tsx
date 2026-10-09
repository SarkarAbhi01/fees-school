import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, rupees } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorText, Panel, Select, td, th } from '../components/ui';
import PeriodFilter, { Period, defaultPeriod, periodQuery } from '../components/PeriodFilter';
import SortTh from '../components/SortTh';

interface Res {
  range: { period: string; from: string; to: string }; scope: 'all' | 'mine';
  totals: { receipts: number; students: number; collected: number; discount: number };
  by_class: { class: string; receipts: number; students: number; collected: number; discount: number }[];
  by_head: { head: string; collected: number }[];
  by_mode: { mode: string; receipts: number; collected: number }[];
  by_day: { date: string; receipts: number; collected: number }[];
  classes: string[]; collectors: { id: string; name: string }[];
}
const MODES = ['CASH', 'UPI', 'CARD', 'CHEQUE'];
const label = (p: string) => ({ today: 'Today', yesterday: 'Yesterday', week: 'This week', month: 'This month', custom: 'Selected dates' }[p] ?? p);

function useSort<T>(rows: T[], initial: string, initialDir: 'asc' | 'desc', cmp: Record<string, (a: T, b: T) => number>) {
  const [sort, setSort] = useState(initial);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir);
  const sorted = useMemo(() => [...rows].sort((a, b) => (dir === 'asc' ? 1 : -1) * cmp[sort](a, b)), [rows, sort, dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSort = (k: string) => { if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir(k === 'class' || k === 'date' ? 'asc' : 'desc'); } };
  return { sorted, sort, dir, onSort };
}

export default function FeeReports() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SCHOOL_ADMIN';
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const [cls, setCls] = useState('');
  const [mode, setMode] = useState('');
  const [collector, setCollector] = useState('');
  const [res, setRes] = useState<Res | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setRes(await api<Res>(`/api/fees/summary?${periodQuery(period)}&class=${encodeURIComponent(cls)}&mode=${mode}&collector=${collector}`)); setError(''); }
    catch (e: any) { setError(e.message); }
  }, [period, cls, mode, collector]);
  useEffect(() => { load(); }, [load]);

  const byClass = useSort(res?.by_class ?? [], 'class', 'asc', {
    class: (a, b) => (Number(a.class) && Number(b.class) ? Number(a.class) - Number(b.class) : a.class.localeCompare(b.class)),
    receipts: (a, b) => a.receipts - b.receipts, students: (a, b) => a.students - b.students, collected: (a, b) => a.collected - b.collected, discount: (a, b) => a.discount - b.discount,
  });
  const byDay = useSort(res?.by_day ?? [], 'date', 'desc', { date: (a, b) => a.date.localeCompare(b.date), receipts: (a, b) => a.receipts - b.receipts, collected: (a, b) => a.collected - b.collected });
  const byHead = useSort(res?.by_head ?? [], 'collected', 'desc', { head: (a, b) => a.head.localeCompare(b.head), collected: (a, b) => a.collected - b.collected });

  const t = res?.totals;
  const max = Math.max(1, ...(res?.by_class.map((c) => c.collected) ?? [1]));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Fee Reports</h1>
      <p className="text-sm text-slate-500">Collection for today, this week, this month or any dates. {res?.scope === 'mine' ? 'Showing your own collections.' : 'Break it down by class, fee, payment mode and day.'}</p>
      <ErrorText>{error}</ErrorText>

      <div className="flex flex-wrap items-center gap-3">
        <PeriodFilter value={period} onChange={setPeriod} />
        <Select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class">
          <option value="">All classes</option>{res?.classes.map((c) => <option key={c} value={c}>Class {c}</option>)}
        </Select>
        <Select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Payment mode">
          <option value="">All payment modes</option>{MODES.map((m) => <option key={m} value={m}>{m[0] + m.slice(1).toLowerCase()}</option>)}
        </Select>
        {isAdmin && (
          <Select value={collector} onChange={(e) => setCollector(e.target.value)} aria-label="Collected by">
            <option value="">All collectors</option>{res?.collectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white p-6"><p className="text-sm text-slate-500">{res ? label(res.range.period) : 'Today'} · collected</p><p className="mt-2 font-display text-4xl font-bold text-board">{rupees(t?.collected ?? 0)}</p></div>
        <div className="bg-white p-6"><p className="text-sm text-slate-500">Receipts</p><p className="mt-2 font-display text-4xl font-bold">{t?.receipts ?? 0}</p></div>
        <div className="bg-white p-6"><p className="text-sm text-slate-500">Students who paid</p><p className="mt-2 font-display text-4xl font-bold">{t?.students ?? 0}</p></div>
        <div className="bg-white p-6"><p className="text-sm text-slate-500">Other discount given</p><p className="mt-2 font-display text-4xl font-bold text-late">{rupees(t?.discount ?? 0)}</p></div>
      </div>

      <Panel className="overflow-hidden">
        <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Class-wise collection</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <SortTh label="Class" k="class" sort={byClass.sort} dir={byClass.dir} onSort={byClass.onSort} />
                <SortTh label="Receipts" k="receipts" sort={byClass.sort} dir={byClass.dir} onSort={byClass.onSort} />
                <SortTh label="Students" k="students" sort={byClass.sort} dir={byClass.dir} onSort={byClass.onSort} />
                <SortTh label="Collected" k="collected" sort={byClass.sort} dir={byClass.dir} onSort={byClass.onSort} />
                <SortTh label="Other discount" k="discount" sort={byClass.sort} dir={byClass.dir} onSort={byClass.onSort} />
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byClass.sorted.map((c) => (
                <tr key={c.class}>
                  <td className={`${td} font-semibold`}>Class {c.class}</td><td className={td}>{c.receipts}</td><td className={td}>{c.students}</td>
                  <td className={`${td} font-semibold`}>{rupees(c.collected)}</td><td className={td}>{c.discount > 0 ? rupees(c.discount) : '—'}</td>
                  <td className={`${td} w-1/4`}><div className="h-2 rounded-sm bg-board-100"><div className="h-2 rounded-sm bg-board" style={{ width: `${(c.collected / max) * 100}%` }} /></div></td>
                </tr>
              ))}
              {res && res.by_class.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">No collection in this period.</td></tr>}
              {res && res.by_class.length > 0 && (
                <tr className="bg-slate-50 font-bold"><td className={td}>Total</td><td className={td}>{t?.receipts}</td><td className={td}>{t?.students}</td><td className={td}>{rupees(t?.collected ?? 0)}</td><td className={td}>{rupees(t?.discount ?? 0)}</td><td className={td}></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel className="overflow-hidden">
          <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Fee-wise collection</h2>
          <table className="w-full">
            <thead className="bg-slate-50"><tr><SortTh label="Fee" k="head" sort={byHead.sort} dir={byHead.dir} onSort={byHead.onSort} /><SortTh label="Collected" k="collected" sort={byHead.sort} dir={byHead.dir} onSort={byHead.onSort} /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {byHead.sorted.map((h) => <tr key={h.head}><td className={td}>{h.head}</td><td className={`${td} font-semibold`}>{rupees(h.collected)}</td></tr>)}
              {res && res.by_head.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-sm text-slate-500">Nothing collected.</td></tr>}
            </tbody>
          </table>
        </Panel>
        <Panel className="overflow-hidden">
          <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Payment mode</h2>
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className={th}>Mode</th><th className={th}>Receipts</th><th className={th}>Collected</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {res?.by_mode.map((m) => <tr key={m.mode}><td className={td}>{m.mode[0] + m.mode.slice(1).toLowerCase()}</td><td className={td}>{m.receipts}</td><td className={`${td} font-semibold`}>{rupees(m.collected)}</td></tr>)}
              {res && res.by_mode.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">Nothing collected.</td></tr>}
            </tbody>
          </table>
        </Panel>
      </div>

      {(res?.by_day.length ?? 0) > 1 && (
        <Panel className="overflow-hidden">
          <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Day-wise collection</h2>
          <table className="w-full">
            <thead className="bg-slate-50"><tr><SortTh label="Date" k="date" sort={byDay.sort} dir={byDay.dir} onSort={byDay.onSort} /><SortTh label="Receipts" k="receipts" sort={byDay.sort} dir={byDay.dir} onSort={byDay.onSort} /><SortTh label="Collected" k="collected" sort={byDay.sort} dir={byDay.dir} onSort={byDay.onSort} /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {byDay.sorted.map((d) => (
                <tr key={d.date}><td className={td}>{new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td><td className={td}>{d.receipts}</td><td className={`${td} font-semibold`}>{rupees(d.collected)}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
