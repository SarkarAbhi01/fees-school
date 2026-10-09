import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { FY_MONTHS, SHORT_MONTHS } from '../lib/feePeriods';
import { Button, ErrorText, Input, Panel, Select } from '../components/ui';

type Scope = 'SCHOOL' | 'CLASS' | 'STUDENT';
interface Row { head_id: string; name: string; months: boolean[]; own: boolean; inherited_from: string; dirty?: boolean; reset?: boolean }
interface Res { fy: { start: number; label: string }; scope: Scope; class: string; student: { name: string; class: string; unique_no: string } | null; heads: Row[] }

const nowFy = () => { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; };
const SRC: Record<string, string> = { SCHOOL: 'whole-school setting', CLASS: 'class setting', STUDENT: 'student setting', DEFAULT: 'all 12 months' };
const PRESETS: { label: string; off: number[] }[] = [
  { label: 'All months', off: [] }, { label: 'Skip May, Jun', off: [1, 2] }, { label: 'Skip Apr', off: [0] }, { label: 'Skip Apr, May, Jun', off: [0, 1, 2] }, { label: 'None', off: [...Array(12).keys()] },
];

export default function FeeMonths() {
  const [fy, setFy] = useState(nowFy());
  const [scope, setScope] = useState<Scope>('SCHOOL');
  const [classes, setClasses] = useState<string[]>([]);
  const [cls, setCls] = useState('');
  const [uid, setUid] = useState(''); const [loadedUid, setLoadedUid] = useState('');
  const [res, setRes] = useState<Res | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ data: { class: string }[] }>('/api/students/classes').then((r) => { setClasses(r.data.map((c) => c.class)); setCls((c) => c || r.data[0]?.class || ''); }).catch(() => {}); }, []);

  const load = useCallback(async () => {
    if (scope === 'CLASS' && !cls) return;
    if (scope === 'STUDENT' && !loadedUid) { setRes(null); setRows([]); return; }
    try {
      const qs = new URLSearchParams({ fy: String(fy), scope, class: cls, unique_no: loadedUid });
      const r = await api<Res>(`/api/fees/month-map?${qs}`);
      setRes(r); setRows(r.heads); setError('');
    } catch (e: any) { setRes(null); setRows([]); setError(e.message); }
  }, [fy, scope, cls, loadedUid]);
  useEffect(() => { load(); }, [load]);

  const edit = (i: number, months: boolean[]) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, months, dirty: true, reset: false } : r)));
  const toggle = (i: number, m: number) => edit(i, rows[i].months.map((v, k) => (k === m ? !v : v)));
  const reset = (i: number) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, reset: true, dirty: true, own: false } : r)));

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setOk('');
    try {
      const items = rows.filter((r) => r.dirty).map((r) => ({ head_id: r.head_id, months: r.reset ? null : r.months }));
      if (!items.length) { setOk('Nothing changed.'); setBusy(false); return; }
      await api('/api/fees/month-map', { method: 'PUT', body: { fy, scope, class: cls, unique_no: loadedUid, items } });
      setOk('Saved. Collect Fee now charges only the months you ticked.'); await load();
    } catch (err: any) { setError(err.message); }
    setBusy(false);
  }

  const dirty = rows.some((r) => r.dirty);
  const seg = (active: boolean) => `h-10 flex-1 px-4 text-sm font-semibold sm:flex-none ${active ? 'bg-board text-white' : 'bg-white hover:bg-board-50'}`;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">Fee Months</h1>
      <p className="text-sm text-slate-600">Choose the months in which each fee is taken. A month left unticked charges nothing for that fee (for example Tuition taken in April, not in May and June, taken again from July). A single student's setting beats the class setting, which beats the whole-school setting.</p>
      <ErrorText>{error}</ErrorText>
      {ok && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{ok}</p>}

      <Panel className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Financial year</span>
            <Select value={fy} onChange={(e) => setFy(Number(e.target.value))} aria-label="Financial year">{[nowFy() - 1, nowFy(), nowFy() + 1].map((y) => <option key={y} value={y}>{y}-{String((y + 1) % 100).padStart(2, '0')}</option>)}</Select>
          </label>
          <div role="radiogroup" aria-label="Apply to" className="flex w-full overflow-hidden rounded-md border border-slate-300 sm:w-auto">
            {([['SCHOOL', 'Whole school'], ['CLASS', 'One class'], ['STUDENT', 'One student']] as [Scope, string][]).map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={scope === k} onClick={() => setScope(k)} className={seg(scope === k)}>{l}</button>)}
          </div>
          {scope === 'CLASS' && <Select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class">{classes.map((c) => <option key={c} value={c}>Class {c}</option>)}</Select>}
          {scope === 'STUDENT' && (
            <div className="flex w-full gap-2 sm:w-auto"><Input value={uid} onChange={(e) => setUid(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setLoadedUid(uid.trim()); }} placeholder="Student unique no, e.g. STU-0001" className="sm:w-64" aria-label="Student unique no" /><Button type="button" variant="outline" onClick={() => setLoadedUid(uid.trim())}>Load</Button></div>
          )}
        </div>
        {res?.student && <p className="text-sm"><b>{res.student.name}</b> · Class {res.student.class} · {res.student.unique_no}</p>}
      </Panel>

      {rows.length === 0 && !error && <p className="py-6 text-center text-sm text-slate-500">{scope === 'STUDENT' ? 'Enter a student unique no and press Load.' : 'No fee heads yet. Add them under Fees > Fee Heads.'}</p>}

      <form onSubmit={save} className="space-y-3">
        {rows.map((r, i) => (
          <Panel key={r.head_id} className="p-3 sm:p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{r.name}</p>
                <p className="text-xs text-slate-500">{r.reset ? 'Will go back to the higher setting when you save' : r.own ? `Own ${scope === 'SCHOOL' ? 'whole-school' : scope === 'CLASS' ? 'class' : 'student'} setting` : `Using ${SRC[r.inherited_from]}`}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => <button type="button" key={p.label} onClick={() => edit(i, Array.from({ length: 12 }, (_, m) => !p.off.includes(m)))} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold hover:bg-board-50">{p.label}</button>)}
                {scope !== 'SCHOOL' && r.own && <button type="button" onClick={() => reset(i)} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-bad hover:bg-bad/5">Remove own setting</button>}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
              {SHORT_MONTHS.map((name, m) => (
                <button type="button" key={m} role="checkbox" aria-checked={r.months[m]} aria-label={`${r.name} ${FY_MONTHS[m]}`} onClick={() => toggle(i, m)}
                  className={`h-11 rounded-md border text-sm font-semibold ${r.months[m] ? 'border-board bg-board text-white' : 'border-slate-300 bg-white text-slate-400 line-through'}`}>{name}</button>
              ))}
            </div>
          </Panel>
        ))}
        {rows.length > 0 && <div className="sticky bottom-0 -mx-3 flex gap-2 border-t border-slate-200 bg-paper/95 p-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0"><Button type="submit" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save months'}</Button>{dirty && <Button type="button" variant="outline" onClick={load}>Undo changes</Button>}</div>}
      </form>
    </div>
  );
}
