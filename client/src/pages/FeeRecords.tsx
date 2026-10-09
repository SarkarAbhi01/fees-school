import { useCallback, useEffect, useState } from 'react';
import { api, rupees } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, ErrorText, Input, Modal, Pager, Panel, Select, td, th } from '../components/ui';
import PeriodFilter, { Period, defaultPeriod, periodQuery } from '../components/PeriodFilter';
import SortTh from '../components/SortTh';
import { ReceiptData, ReceiptView, planShort } from '../components/Receipt';

interface Row {
  receipt_no: string; payment_date: string; student_name: string; unique_no: string; class: string; section: string; left_school: boolean;
  payment_mode: string; billing_mode: string; months: number; amount_paid: number; discount_amount: number; pending_amount: number;
  reprint_count: number; collected_by: string | null; lines: { head_name: string; amount: number }[];
}
interface Res {
  data: Row[]; total: number; totals: { receipts: number; collected: number; discount: number };
  classes: string[]; collectors: { id: string; name: string }[];
}
const MODES = ['CASH', 'UPI', 'CARD', 'CHEQUE'];

export default function FeeRecords() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SCHOOL_ADMIN';
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const [cls, setCls] = useState('');
  const [mode, setMode] = useState('');
  const [collector, setCollector] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('date');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Res | null>(null);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async () => {
    const qs = `${periodQuery(period)}&class=${encodeURIComponent(cls)}&mode=${mode}&collector=${collector}&search=${encodeURIComponent(q)}&sort=${sort}&dir=${dir}&page=${page}&limit=50`;
    try { setRes(await api<Res>(`/api/fees/records?${qs}`)); setError(''); } catch (e: any) { setError(e.message); }
  }, [period, cls, mode, collector, q, sort, dir, page]);
  useEffect(() => { load(); }, [load]);

  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const onSort = (k: string) => { if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir(k === 'name' || k === 'class' || k === 'receipt' ? 'asc' : 'desc'); } setPage(1); };

  async function reprint(no: string) {
    setError('');
    try { setReceipt((await api<{ receipt: ReceiptData }>(`/api/fees/receipts/${encodeURIComponent(no)}`)).receipt); load(); }
    catch (e: any) { setError(e.message); }
  }

  const t = res?.totals;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Fee Records</h1>
      <p className="text-sm text-slate-500">{isAdmin ? 'Every receipt submitted' : 'Receipts you collected'}. Filter, sort, and reprint a receipt if a parent or student needs another copy.</p>
      <ErrorText>{error}</ErrorText>

      <div className="flex flex-wrap items-center gap-3">
        <PeriodFilter value={period} onChange={filter(setPeriod)} />
        <Select value={cls} onChange={(e) => filter(setCls)(e.target.value)} aria-label="Class">
          <option value="">All classes</option>{res?.classes.map((c) => <option key={c} value={c}>Class {c}</option>)}
        </Select>
        <Select value={mode} onChange={(e) => filter(setMode)(e.target.value)} aria-label="Payment mode">
          <option value="">All payment modes</option>{MODES.map((m) => <option key={m} value={m}>{m[0] + m.slice(1).toLowerCase()}</option>)}
        </Select>
        {isAdmin && (
          <Select value={collector} onChange={(e) => filter(setCollector)(e.target.value)} aria-label="Collected by">
            <option value="">All collectors</option>{res?.collectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Student name, unique no or receipt no" className="max-w-xs" aria-label="Search receipts" />
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3">
        <div className="bg-white p-5"><p className="text-sm text-slate-500">Collected</p><p className="mt-1 font-display text-3xl font-bold text-board">{rupees(t?.collected ?? 0)}</p></div>
        <div className="bg-white p-5"><p className="text-sm text-slate-500">Receipts</p><p className="mt-1 font-display text-3xl font-bold">{t?.receipts ?? 0}</p></div>
        <div className="bg-white p-5"><p className="text-sm text-slate-500">Other discount given</p><p className="mt-1 font-display text-3xl font-bold text-late">{rupees(t?.discount ?? 0)}</p></div>
      </div>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <SortTh label="Date & time" k="date" sort={sort} dir={dir} onSort={onSort} />
                <SortTh label="Receipt" k="receipt" sort={sort} dir={dir} onSort={onSort} />
                <SortTh label="Student" k="name" sort={sort} dir={dir} onSort={onSort} />
                <SortTh label="Class" k="class" sort={sort} dir={dir} onSort={onSort} />
                <th className={th}>Fees</th><th className={th}>Type</th><th className={th}>Mode</th>
                <SortTh label="Paid" k="amount" sort={sort} dir={dir} onSort={onSort} />
                <SortTh label="Discount" k="discount" sort={sort} dir={dir} onSort={onSort} />
                {isAdmin && <th className={th}>Collected by</th>}
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {res?.data.map((r) => (
                <tr key={r.receipt_no} className="hover:bg-board-50">
                  <td className={td}>{new Date(r.payment_date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className={td}>{r.receipt_no}</td>
                  <td className={td}><span className="font-medium">{r.student_name}</span> <span className="text-slate-500">{r.unique_no}</span>{r.left_school && <> <Badge kind="LEFT" /></>}</td>
                  <td className={td}>{r.class}{r.section ? `-${r.section}` : ''}</td>
                  <td className={td}>{r.lines.map((l) => `${l.head_name} ${rupees(l.amount)}`).join(', ') || '—'}</td>
                  <td className={td}>{planShort(r.billing_mode, r.months)}</td>
                  <td className={td}>{r.payment_mode}</td>
                  <td className={`${td} font-semibold`}>{rupees(r.amount_paid)}</td>
                  <td className={td}>{r.discount_amount > 0 ? rupees(r.discount_amount) : '—'}</td>
                  {isAdmin && <td className={td}>{r.collected_by ?? '—'}</td>}
                  <td className={td}>
                    <Button variant="outline" className="h-8 px-3" onClick={() => reprint(r.receipt_no)}>Reprint</Button>
                    {r.reprint_count > 0 && <span className="ml-2 text-xs text-slate-500">{r.reprint_count}× printed again</span>}
                  </td>
                </tr>
              ))}
              {res && res.data.length === 0 && <tr><td colSpan={isAdmin ? 11 : 10} className="px-4 py-8 text-center text-sm text-slate-500">No receipts for these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={page} limit={50} total={res?.total ?? 0} onPage={setPage} />
      </Panel>

      {receipt && (
        <Modal title="Reprint receipt" onClose={() => setReceipt(null)}>
          <ReceiptView receipt={receipt}><Button variant="outline" onClick={() => setReceipt(null)}>Close</Button></ReceiptView>
        </Modal>
      )}
    </div>
  );
}
