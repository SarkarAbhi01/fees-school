import { FormEvent, useEffect, useState } from 'react';
import { api, rupees } from '../lib/api';
import { Button, ErrorText, Field, Input, Panel } from '../components/ui';

export default function LateFee() {
  const [due, setDue] = useState('10');
  const [late, setLate] = useState('0');
  const [from, setFrom] = useState('');
  const [error, setError] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ due_day: number; late_fee_amount: number; late_fee_from: string }>('/api/fees/settings')
      .then((r) => { setDue(String(r.due_day)); setLate(String(r.late_fee_amount)); setFrom(r.late_fee_from); }).catch((e) => setError(e.message));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setOk('');
    try { const r = await api<{ late_fee_from: string }>('/api/fees/settings', { method: 'PUT', body: { due_day: Number(due), late_fee_amount: Number(late), late_fee_from: from } }); setFrom(r.late_fee_from); setOk('Saved.'); }
    catch (err: any) { setError(err.message); }
    setBusy(false);
  }
  const d = Number(due) || 10, l = Number(late) || 0;
  const th = (n: number) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Due Date &amp; Late Fee</h1>
      <p className="text-sm text-slate-600">Every month's fee must be paid on or before the last date. If a month is not fully paid by then, one flat late fee is added to that month, once, on the month's total fees. It is not added to each fee head separately.</p>
      <ErrorText>{error}</ErrorText>
      {ok && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{ok}</p>}
      <Panel className="p-4 sm:p-6">
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Last date to pay (day of the month, 1 to 28)"><Input type="number" min={1} max={28} required value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Late fee per month (₹, 0 = no late fee)"><Input type="number" min={0} required value={late} onChange={(e) => setLate(e.target.value)} /></Field>
          </div>
          <Field label="Charge late fee only for months due on or after">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="mt-1 block text-xs text-slate-500">Leave empty to start from today when you first save a late fee, so old unpaid months are not charged retroactively.</span>
          </Field>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </form>
      </Panel>
      <Panel className="p-4 text-sm sm:p-5">
        <p className="mb-1 font-semibold">How it works for September</p>
        {l > 0
          ? <p className="text-slate-700">Last date is <b>{d}{th(d)} September</b>. September's fees total ₹300 (tuition, exam, transport together). Paid on or before {d}{th(d)}: collect <b>₹300</b>. Paid on {d + 1}{th(d + 1)} or later: collect ₹300 + {rupees(l)} late fee = <b>{rupees(300 + l)}</b>. October is checked separately against {d}{th(d)} October.</p>
          : <p className="text-slate-700">No late fee is charged. Enter an amount such as ₹10 or ₹20 to switch it on.</p>}
        <p className="mt-2 text-xs text-slate-500">The cashier can waive a late fee on the Collect Fee screen with the "Other discount" box (a reason is required and is recorded).</p>
      </Panel>
    </div>
  );
}
