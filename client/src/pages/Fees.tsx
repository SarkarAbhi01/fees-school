import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rupees } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, ErrorText, Input, Panel, Select, td, th } from '../components/ui';
import { ReceiptData, ReceiptView, planShort } from '../components/Receipt';
import { PLANS, Plan, chosenMonths, monthLeft, monthStatus, payableMonths, suggest } from '../lib/plan';
import { FY_MONTHS, FeePeriod, Inst, SHORT_MONTHS, describeFee } from '../lib/feePeriods';

interface Head {
  head_id: string; name: string; gross: number; admin_discount: number; admin_breakdown: { name: string; amount: number }[];
  other_discount: number; base: number; paid: number; left: number; is_custom: boolean; billed_months: number; start_idx: number;
  is_late: boolean; enabled: boolean[]; paid_to: number; months: { m: number; due: number; covered: number; left: number }[];
  period: FeePeriod | 'LATE'; rate: number; installments: Inst[] | null; items: { label: string; month: number; amount: number; paid: boolean }[];
}
interface Line { head_name: string; amount: number }
interface Result {
  student: { name: string; class: string; section: string; photo: string | null; unique_no: string; uses_transport: boolean; is_active: boolean };
  inactive: boolean;
  fy: { label: string; billed_months: number; billing_from: string | null };
  heads: Head[]; applied_discounts: { name: string }[];
  late: { amount: number; due_day: number; months: number[]; total: number; paid: number; left: number };
  total_fee: number; admin_discount: number; other_discount: number; total_paid: number; fees_left: number;
  fee_structure_missing: boolean; message: string | null;
  payment_history: { receipt_no: string; payment_date: string; payment_mode: string; billing_mode: string; months: number; amount_paid: number; discount_amount: number; pending_amount: number; lines: Line[] }[];
}

const num = (v: string | undefined) => Number(v || 0);

export default function Fees() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<Result | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [billing, setBilling] = useState<Plan>('MONTHLY'); // Monthly is the default
  const [months, setMonths] = useState(1);
  const [startMonth, setStartMonth] = useState<number | null>(null); // fee month chosen in the dropdown (0 = April)
  const [pay, setPay] = useState<Record<string, string>>({});
  const [disc, setDisc] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'CASH' | 'UPI'>('CASH');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const payRef = useRef<HTMLInputElement>(null);

  async function fetchStudent(q: string) {
    const r = await api<Result>(`/api/fees/search?query=${encodeURIComponent(q.trim())}`);
    setData(r);
    return r;
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setError(''); setReceipt(null); setDisc({}); setReason(''); setBilling('MONTHLY'); setMonths(1); setStartMonth(null);
    try { await fetchStudent(query); setTimeout(() => payRef.current?.focus(), 50); }
    catch (err: any) { setData(null); setError(err.message); }
  }

  const heads = data?.heads ?? [];
  const open = useMemo(() => payableMonths(heads), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const startValid = startMonth !== null && open.includes(startMonth) ? startMonth : (open[0] ?? null);
  const chosen = useMemo(() => chosenMonths(heads, startValid, billing, months), [data, startValid, billing, months]); // eslint-disable-line react-hooks/exhaustive-deps
  const dueOf = (m: number) => heads.reduce((t, h) => t + (h.months[m]?.left ?? 0), 0);
  const lateOf = (m: number) => heads.find((h) => h.is_late)?.months[m]?.left ?? 0;

  // Auto-fill "pay now" with what is due for the chosen month(s); the cashier can still change each amount.
  useEffect(() => {
    if (!data) return;
    const amounts = suggest(data.heads, chosen, Object.fromEntries(Object.entries(disc).map(([k, v]) => [k, num(v)])));
    const next: Record<string, string> = {};
    for (const h of data.heads) next[h.head_id] = amounts[h.head_id] ? String(amounts[h.head_id]) : '';
    setPay(next);
  }, [data, chosen, disc]);

  const totalPay = (data?.heads ?? []).reduce((a, h) => a + num(pay[h.head_id]), 0);
  const totalDisc = (data?.heads ?? []).reduce((a, h) => a + num(disc[h.head_id]), 0);
  const overHead = (data?.heads ?? []).find((h) => num(pay[h.head_id]) + num(disc[h.head_id]) > monthLeft(h, chosen) || !Number.isInteger(num(pay[h.head_id])) || !Number.isInteger(num(disc[h.head_id])));
  const invalid = !data || !chosen.length || totalPay <= 0 || !!overHead || (totalDisc > 0 && !reason.trim());

  async function collect(e: FormEvent) {
    e.preventDefault();
    if (!data || invalid || busy) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ receipt: ReceiptData }>('/api/fees/collect', {
        body: {
          unique_no: data.student.unique_no, payment_mode: mode, billing_mode: billing, months: chosen, discount_reason: reason,
          lines: data.heads.map((h) => ({ head_id: h.head_id, amount: num(pay[h.head_id]), other_discount: num(disc[h.head_id]) })),
        },
      });
      setReceipt(r.receipt); setDisc({}); setReason(''); setStartMonth(null); setMonths(1);
      await fetchStudent(data.student.unique_no); // refresh balances + history
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  const receiptRef = useRef<HTMLDivElement>(null);
  async function reprint(no: string) {
    setError('');
    try {
      const r = await api<{ receipt: ReceiptData }>(`/api/fees/receipts/${encodeURIComponent(no)}`);
      setReceipt(r.receipt);
      setTimeout(() => receiptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      if (data) fetchStudent(data.student.unique_no);
    } catch (err: any) { setError(err.message); }
  }

  function next() { setData(null); setReceipt(null); setQuery(''); setError(''); searchRef.current?.focus(); }

  const left = data?.fees_left ?? 0;
  const tab = (active: boolean) => `px-5 text-sm font-semibold ${active ? 'bg-board text-white' : 'bg-white text-ink hover:bg-board-50'}`;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <form onSubmit={search} className="no-print">
        <Input
          ref={searchRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by Unique No / RFID / Phone, then press Enter"
          className="h-14 text-lg" aria-label="Search student"
        />
      </form>
      <div className="no-print"><ErrorText>{error}</ErrorText></div>

      {!data && !error && <p className="no-print py-10 text-center text-slate-500">Type STU-0001, a card number or the parent's phone to start collecting.</p>}

      {data && (
        <>
          <div className="no-print grid gap-5 md:grid-cols-[1fr_1fr]">
            <Panel className="flex items-center gap-4 p-5">
              {data.student.photo
                ? <img src={data.student.photo} alt="" className="h-20 w-20 rounded-md object-cover" />
                : <div className="flex h-20 w-20 items-center justify-center rounded-md bg-board-100 font-display text-3xl font-bold text-board">{data.student.name.charAt(0)}</div>}
              <div>
                <p className="font-display text-xl font-bold">{data.student.name}</p>
                <p className="text-slate-600">Class {data.student.class}{data.student.section ? `-${data.student.section}` : ''}{data.student.uses_transport ? ' · Transport' : ''}{data.inactive ? ' · Left school' : ''}</p>
                <p className="text-sm text-slate-500">{data.student.unique_no}</p>
                <p className="text-sm text-slate-500">Financial year {data.fy.label}{data.fy.billing_from ? ` · billing from ${data.fy.billing_from}` : ''}</p>
              </div>
            </Panel>

            <Panel className="p-5">
              {!data.inactive && data.fee_structure_missing && (
                <p className="mb-2 text-sm text-late">
                  No fee is set for Class {data.student.class}. Add a fee structure first.{' '}
                  {user?.role === 'SCHOOL_ADMIN'
                    ? <Link to="/fees/structure" className="font-semibold text-board underline">Open Fee Structure</Link>
                    : <span>Ask your school admin to add it.</span>}
                </p>
              )}
              {data.inactive && <p role="alert" className="mb-3 rounded-md bg-bad/10 px-3 py-2 text-sm font-semibold text-bad">{data.message}</p>}
              {!data.inactive && !data.fee_structure_missing && data.message && <p className="mb-2 text-sm text-late">{data.message}</p>}
              <div className="flex justify-between text-sm text-slate-600"><span>Total fee (after admin discount, without late fee)</span><b className="text-ink">{rupees(data.total_fee)}</b></div>
              {data.admin_discount > 0 && <div className="mt-1 flex justify-between text-sm text-slate-600"><span>Admin discount applied</span><b className="text-good">{rupees(data.admin_discount)}</b></div>}
              {data.other_discount > 0 && <div className="mt-1 flex justify-between text-sm text-slate-600"><span>Other discount given</span><b className="text-good">{rupees(data.other_discount)}</b></div>}
              {data.late.total > 0 && <div className="mt-1 flex justify-between text-sm text-slate-600"><span>Late fee ({data.late.months.map((m) => FY_MONTHS[m].slice(0, 3)).join(', ')})</span><b className="text-late">{rupees(data.late.total)}</b></div>}
              <div className="mt-1 flex justify-between text-sm text-slate-600"><span>Paid</span><b className="text-good">{rupees(data.total_paid)}</b></div>
              {!data.inactive && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <p className="text-sm text-slate-600">Left to pay</p>
                  <p className={`font-display text-5xl font-bold ${left > 0 ? 'text-bad' : 'text-good'}`}>{rupees(left)}</p>
                </div>
              )}
            </Panel>
          </div>

          {data.heads.length > 0 && !data.inactive && (
            <Panel className="no-print overflow-hidden">
              <form onSubmit={collect}>
                <div className="space-y-3 border-b border-slate-200 p-3 sm:p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block min-w-[10rem] flex-1 sm:flex-none">
                      <span className="mb-1 block text-xs font-medium text-slate-600">Fee month</span>
                      <Select value={startValid ?? ''} disabled={billing === 'YEARLY' || !open.length} onChange={(e) => setStartMonth(Number(e.target.value))} className="h-12 w-full text-sm font-semibold sm:min-w-[16rem]" aria-label="Fee month">
                        {open.length === 0 && <option value="">Nothing left to pay</option>}
                        {open.map((m) => <option key={m} value={m}>{FY_MONTHS[m]} — {rupees(dueOf(m))} due{lateOf(m) > 0 ? ` (incl. late fee ${rupees(lateOf(m))})` : ''}</option>)}
                      </Select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-600">Pay</span>
                      <Select value={billing} onChange={(e) => { setBilling(e.target.value as Plan); setMonths(1); }} className="h-12 text-sm font-semibold" aria-label="Pay">
                        {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </Select>
                    </label>
                    {billing === 'MONTHLY' && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <span>for</span>
                        <Input type="number" min={1} max={Math.max(1, open.length)} value={months} onChange={(e) => setMonths(Math.min(Math.max(1, open.length), Math.max(1, Number(e.target.value) || 1)))} className="h-12 w-20 text-center text-lg" aria-label="Number of months" />
                        <span>month{months > 1 ? 's' : ''}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5" aria-label="Fee months of this year">
                    {FY_MONTHS.map((name, m) => {
                      const st = monthStatus(heads, m), picked = chosen.includes(m);
                      const tone = picked ? 'border-board bg-board text-white' : st === 'paid' ? 'border-good/30 bg-good/10 text-good' : st === 'due' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-slate-200 bg-slate-50 text-slate-400';
                      return (
                        <button type="button" key={m} disabled={st !== 'due'} onClick={() => { setStartMonth(m); }} title={st === 'off' ? 'No fee this month' : st === 'paid' ? 'Paid' : st === 'due' ? `${rupees(dueOf(m))} due` : ''}
                          className={`rounded-md border px-2 py-1 text-xs font-semibold disabled:cursor-default ${tone}`}>
                          {name.slice(0, 3)}{st === 'paid' ? ' ✓' : st === 'off' ? ' –' : ''}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-sm text-slate-600">
                    {!chosen.length ? 'Nothing left to pay.' : <>Collecting for <b className="text-ink">{chosen.map((m) => FY_MONTHS[m]).join(', ')}</b>. Change the amounts below if needed.</>}
                    <span className="block text-xs text-slate-500">✓ paid · red = due · – = fee not taken that month (set in Fee Months)</span>
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr><th className={th}>Fee</th><th className={th}>Fee for year</th><th className={th}>Paid</th><th className={th}>Paid up to</th><th className={th}>Balance</th><th className={th}>Due now</th><th className={th}>Other discount</th><th className={th}>Pay now</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.heads.map((h, i) => (
                        <tr key={h.head_id} className={h.is_late ? 'bg-late/5' : undefined}>
                          <td className={`${td} font-medium`}>
                            {h.name}{h.is_late && <span className="ml-2 rounded-sm bg-late/10 px-1.5 py-0.5 text-xs font-semibold text-late">After last date</span>}{h.is_custom && <span className="ml-2 rounded-sm bg-board-100 px-1.5 py-0.5 text-xs font-semibold text-board">Custom fee</span>}
                            <p className="text-xs font-normal text-slate-500">{h.is_late ? `${rupees(h.rate)} for each month not paid by the ${data.late.due_day}th` : describeFee(h.period as FeePeriod, h.rate, h.installments)}</p>
                            {!h.is_late && h.enabled.some((x) => !x) && <p className="text-xs font-normal text-slate-500">No fee in: {FY_MONTHS.filter((_, m) => !h.enabled[m] && m >= h.start_idx).map((x) => x.slice(0, 3)).join(', ')}</p>}
                            {h.items.length > 0 && <p className="text-xs font-normal text-slate-500">{h.items.map((x) => `${x.label} (${SHORT_MONTHS[x.month]}) ${rupees(x.amount)}${x.paid ? ' ✓' : ''}`).join(' · ')}</p>}
                            {h.admin_breakdown.map((b) => <p key={b.name} className="text-xs font-normal text-good">{b.name}: −{rupees(b.amount)}</p>)}
                          </td>
                          <td className={td}>{rupees(h.base)}{h.admin_discount > 0 && <p className="text-xs text-slate-500 line-through">{rupees(h.gross)}</p>}</td>
                          <td className={`${td} text-good`}>{rupees(h.paid + h.other_discount)}</td>
                          <td className={td}>{h.left === 0 ? 'Fully paid' : h.paid_to >= 0 ? FY_MONTHS[h.paid_to] : '—'}</td>
                          <td className={`${td} font-semibold ${h.left > 0 ? 'text-bad' : 'text-good'}`}>{rupees(h.left)}</td>
                          <td className={`${td} font-semibold`}>{rupees(monthLeft(h, chosen))}</td>
                          <td className={td}>
                            {monthLeft(h, chosen) > 0 ? <Input type="number" min={0} max={monthLeft(h, chosen)} value={disc[h.head_id] ?? ''} onChange={(e) => setDisc({ ...disc, [h.head_id]: e.target.value })} placeholder="0" className="h-9 w-28" aria-label={`Other discount for ${h.name}`} /> : '—'}
                          </td>
                          <td className={td}>
                            {monthLeft(h, chosen) > 0 ? <Input ref={i === 0 ? payRef : undefined} type="number" min={0} max={monthLeft(h, chosen)} value={pay[h.head_id] ?? ''} onChange={(e) => setPay({ ...pay, [h.head_id]: e.target.value })} placeholder="0" className="h-9 w-28" aria-label={`Pay for ${h.name}`} /> : <span className={h.left > 0 ? 'text-slate-400' : 'text-good'}>{h.left > 0 ? '—' : 'Paid'}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {left > 0 ? (
                  <div className="space-y-3 border-t border-slate-200 p-4">
                    {totalDisc > 0 && (
                      <div className="max-w-md">
                        <span className="mb-1 block text-sm font-medium text-slate-700">Reason for other discount (required)</span>
                        <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sports quota, hardship" />
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="mr-auto">
                        <p className="text-sm text-slate-600">Collect now{totalDisc > 0 ? ` (discount ${rupees(totalDisc)})` : ''}</p>
                        <p className="font-display text-3xl font-bold text-board">{rupees(totalPay)}</p>
                      </div>
                      <div role="radiogroup" aria-label="Payment mode" className="flex h-12 overflow-hidden rounded-md border border-slate-300">
                        {(['CASH', 'UPI'] as const).map((m) => (
                          <button type="button" key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={tab(mode === m)}>{m === 'CASH' ? 'Cash' : 'UPI'}</button>
                        ))}
                      </div>
                      <Button type="submit" disabled={invalid || busy} className="h-12 px-8 text-base">{busy ? 'Collecting…' : 'Collect'}</Button>
                    </div>
                    {overHead && <p className="text-sm text-bad">{overHead.name}: pay plus discount is more than the {rupees(monthLeft(overHead, chosen))} due for the selected month.</p>}
                  </div>
                ) : <p className="border-t border-slate-200 p-4 font-semibold text-good">All fees are paid for this student.</p>}
              </form>
            </Panel>
          )}

          {receipt && (
            <Panel className="p-6" >
              <div ref={receiptRef}>
                <ReceiptView receipt={receipt}>
                  <Button variant="outline" onClick={next}>Next student</Button>
                </ReceiptView>
              </div>
            </Panel>
          )}

          <Panel className="no-print overflow-hidden">
            <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Payment history</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50"><tr><th className={th}>Date</th><th className={th}>Receipt</th><th className={th}>Fees</th><th className={th}>Type</th><th className={th}>Mode</th><th className={th}>Paid</th><th className={th}>Discount</th><th className={th}>Left after</th><th className={th}></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.payment_history.map((p) => (
                    <tr key={p.receipt_no}>
                      <td className={td}>{new Date(p.payment_date).toLocaleDateString('en-IN')}</td>
                      <td className={td}>{p.receipt_no}</td>
                      <td className={td}>{p.lines.map((l) => `${l.head_name} ${rupees(l.amount)}`).join(', ') || '—'}</td>
                      <td className={td}>{planShort(p.billing_mode, p.months)}</td>
                      <td className={td}>{p.payment_mode}</td>
                      <td className={`${td} font-semibold`}>{rupees(p.amount_paid)}</td>
                      <td className={td}>{p.discount_amount > 0 ? rupees(p.discount_amount) : '—'}</td>
                      <td className={td}>{rupees(p.pending_amount)}</td>
                      <td className={td}><Button variant="outline" className="h-8 px-3" onClick={() => reprint(p.receipt_no)}>Reprint</Button></td>
                    </tr>
                  ))}
                  {data.payment_history.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">No payments yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
