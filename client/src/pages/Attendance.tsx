import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API, api, downloadCsv, downloadFile, timeOf, todayStr } from '../lib/api';
import { Badge, Button, ErrorText, Input, Modal, Pager, Panel, Select, td, th } from '../components/ui';
import SortTh from '../components/SortTh';

interface Row { id: string; name: string; unique_no: string; class: string; section?: string; in_time: string | null; out_time: string | null; status: string }
interface Daily { data: Row[]; summary: { total_students: number; total_present: number; total_late: number; total_absent: number; total_days: number; month: number; year: number }; total: number }
interface Rep { total_days_in_month: number; holidays: { date: string; name: string }[]; data: { student_id: string; unique_no: string; name: string; class: string; total_days: number; total_present_days: number; total_late_days: number; total_absent_days: number; percentage: number }[]; total: number }
interface Feed { type: 'IN' | 'OUT'; late?: boolean; message: string; key: number }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const nice = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function Attendance() {
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily');
  const [classes, setClasses] = useState<string[]>([]);
  const [date, setDate] = useState(todayStr());
  const [cls, setCls] = useState('');
  const [search, setSearch] = useState(''); const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('class'); const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [d, setD] = useState<Daily | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({}); // student id -> status changed on screen, not saved yet
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<Feed[]>([]); const [live, setLive] = useState(false);
  const [holidays, setHolidays] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api<{ data: { class: string }[] }>('/api/students/classes').then((r) => setClasses(r.data.map((c) => c.class))).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ date, page: String(page), limit: '50', search: q, status, sort, dir });
    if (cls) p.set('class', cls);
    try { setD(await api<Daily>(`/api/attendance/daily?${p}`)); setError(''); setDraft({}); } catch (e: any) { setError(e.message); }
  }, [date, cls, page, q, status, sort, dir]);
  useEffect(() => { if (tab === 'daily') load(); }, [load, tab]);

  const loadRef = useRef(load); loadRef.current = load;
  const dateRef = useRef(date); dateRef.current = date;
  const draftRef = useRef(draft); draftRef.current = draft;
  useEffect(() => {
    const es = new EventSource(`${API}/api/attendance/live-stream?token=${localStorage.getItem('token')}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      setFeed((f) => [{ type: m.type, late: m.late, message: m.message, key: Date.now() + Math.random() }, ...f].slice(0, 30));
      // do not wipe ticks the user has not saved yet
      if (dateRef.current === todayStr() && !Object.keys(draftRef.current).length) { clearTimeout(timer); timer = setTimeout(() => loadRef.current(), 800); }
    };
    return () => { clearTimeout(timer); es.close(); };
  }, []);

  const statusOf = (r: Row) => draft[r.id] ?? r.status;
  const checked = (r: Row) => statusOf(r) !== 'ABSENT'; // ticked = present (late counts as present)
  const rows = d?.data ?? [];
  const allTicked = rows.length > 0 && rows.every(checked);
  const someTicked = rows.some(checked);
  const changes = Object.keys(draft).length;

  const setOne = (r: Row, present: boolean) => setDraft((x) => {
    const n = { ...x }; const want = present ? (r.status === 'LATE' ? 'LATE' : 'PRESENT') : 'ABSENT';
    if (want === r.status) delete n[r.id]; else n[r.id] = want;
    return n;
  });
  const setPage_ = (present: boolean) => setDraft(() => {
    const n: Record<string, string> = {};
    for (const r of rows) { const want = present ? (r.status === 'LATE' ? 'LATE' : 'PRESENT') : 'ABSENT'; if (want !== r.status) n[r.id] = want; }
    return n;
  });

  async function saveDraft() {
    setBusy(true); setError(''); setNotice('');
    try {
      const items = Object.entries(draft).map(([student_id, status]) => ({ student_id, status }));
      await api('/api/attendance/mark-bulk', { body: { date, items } });
      setNotice(`${items.length} student${items.length > 1 ? 's' : ''} saved.`); await load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  async function markAll(present: boolean) {
    const who = cls ? `all of Class ${cls}` : 'every student in the school';
    if (!window.confirm(`Mark ${who} as ${present ? 'PRESENT' : 'ABSENT'} on ${nice(date)}?${present ? '' : ' Gate scan times for that day will be cleared.'}`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api<{ students: number; changed: number }>('/api/attendance/mark-bulk', { body: { date, all: true, class: cls || undefined, status: present ? 'PRESENT' : 'ABSENT' } });
      setNotice(`${r.students} students checked, ${r.changed} changed to ${present ? 'present' : 'absent'}.`); await load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  async function mark(id: string, st: string) {
    try { await api('/api/attendance/mark-manual', { body: { student_id: id, date, status: st } }); load(); } catch (e: any) { setError(e.message); }
  }

  async function upload(file?: File) {
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    setNotice(''); setError('');
    try {
      const r = await api<{ saved: number; skipped_blank: number; invalid_rows: number; errors: { row: number; message: string }[] }>('/api/attendance/bulk-upload', { form: fd });
      setNotice(`${r.saved} attendance records saved, ${r.skipped_blank} empty rows skipped, ${r.invalid_rows} with problems.${r.errors.length ? ` Row ${r.errors[0].row}: ${r.errors[0].message}${r.errors.length > 1 ? ` (and ${r.errors.length - 1} more)` : ''}` : ''}`);
      load();
    } catch (e: any) { setError(e.message); }
    if (fileRef.current) fileRef.current.value = '';
  }
  const sheet = (blank: boolean) => {
    const p = new URLSearchParams({ date }); if (cls) p.set('class', cls); if (blank) p.set('blank', '1');
    downloadFile(`/api/attendance/template.xlsx?${p}`, 'Attendance.xlsx').catch((e) => setError(e.message));
  };
  const onSort = (k: string) => { if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('asc'); } setPage(1); };

  const tabBtn = (t: 'daily' | 'monthly', label: string) => <button type="button" onClick={() => setTab(t)} className={`h-10 flex-1 px-5 text-sm font-semibold sm:flex-none ${tab === t ? 'bg-board text-white' : 'bg-white hover:bg-board-50'}`}>{label}</button>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Attendance</h1>
        <Button variant="outline" onClick={() => setHolidays(true)}>Holidays &amp; weekly off</Button>
      </div>
      <div className="flex overflow-hidden rounded-md border border-slate-300 sm:inline-flex">{tabBtn('daily', 'Daily')}{tabBtn('monthly', 'Monthly report')}</div>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{notice}</p>}

      {tab === 'monthly' ? <Monthly classes={classes} onError={setError} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input type="date" value={date} max={todayStr()} onChange={(e) => { setDate(e.target.value || todayStr()); setPage(1); }} aria-label="Date" />
            <Select value={cls} onChange={(e) => { setCls(e.target.value); setPage(1); }} aria-label="Class"><option value="">All classes</option>{classes.map((c) => <option key={c} value={c}>Class {c}</option>)}</Select>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">All status</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option></Select>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or unique no" aria-label="Search" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={() => markAll(true)}>Mark all present{cls ? ` (Class ${cls})` : ''}</Button>
            <Button variant="outline" disabled={busy} onClick={() => markAll(false)}>Mark all absent</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => upload(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => sheet(false)}>Download sheet</Button>
            <Button variant="outline" onClick={() => sheet(true)}>Blank template</Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>Upload Excel / CSV</Button>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
            <Panel className="min-w-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={`${th} w-12`}>
                        <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-board" checked={allTicked} ref={(el) => { if (el) el.indeterminate = someTicked && !allTicked; }} onChange={(e) => setPage_(e.target.checked)} aria-label="Select all present" /><span className="sr-only sm:not-sr-only sm:text-[10px]">All</span></label>
                      </th>
                      <SortTh label="Name" k="name" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Unique No" k="unique_no" sort={sort} dir={dir} onSort={onSort} />
                      <SortTh label="Class" k="class" sort={sort} dir={dir} onSort={onSort} /><SortTh label="In time" k="in_time" sort={sort} dir={dir} onSort={onSort} />
                      <th className={th}>Out time</th><SortTh label="Status" k="status" sort={sort} dir={dir} onSort={onSort} /><th className={th}>Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.id} className={draft[r.id] ? 'bg-late/5' : undefined}>
                        <td className={td}><input type="checkbox" className="h-5 w-5 accent-board" checked={checked(r)} onChange={(e) => setOne(r, e.target.checked)} aria-label={`${r.name} present`} /></td>
                        <td className={`${td} font-medium`}>{r.name}</td><td className={td}>{r.unique_no}</td><td className={td}>{r.class}{r.section ?? ''}</td>
                        <td className={td}>{timeOf(r.in_time)}</td><td className={td}>{timeOf(r.out_time)}</td>
                        <td className={td}><Badge kind={statusOf(r)} />{draft[r.id] && <span className="ml-1 text-xs text-late">unsaved</span>}</td>
                        <td className={td}>
                          <Select value="" onChange={(e) => e.target.value && mark(r.id, e.target.value)} className="h-8 text-xs" aria-label={`Mark ${r.name}`}>
                            <option value="">Mark as…</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option>
                          </Select>
                        </td>
                      </tr>
                    ))}
                    {d && rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">No students match.</td></tr>}
                  </tbody>
                </table>
              </div>
              {d && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm sm:flex sm:flex-wrap sm:gap-x-8">
                  <span>Total present: <b className="text-good">{d.summary.total_present}</b></span>
                  <span>Total late: <b className="text-late">{d.summary.total_late}</b></span>
                  <span>Total absent: <b className="text-bad">{d.summary.total_absent}</b></span>
                  <span>School days in {MONTHS[d.summary.month - 1]} {d.summary.year}: <b>{d.summary.total_days}</b></span>
                </div>
              )}
              <Pager page={page} limit={50} total={d?.total ?? 0} onPage={setPage} />
            </Panel>

            <Panel className="h-fit">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h2 className="font-bold">Live gate feed</h2>
                <span className={`flex items-center gap-1.5 text-xs ${live ? 'text-good' : 'text-slate-500'}`}><span className={`h-2 w-2 rounded-full ${live ? 'bg-good' : 'bg-slate-400'}`} />{live ? 'Connected' : 'Reconnecting'}</span>
              </div>
              <ul className="max-h-[320px] divide-y divide-slate-100 overflow-y-auto xl:max-h-[480px]" aria-live="polite">
                {feed.map((f) => <li key={f.key} className="flex items-start gap-3 px-4 py-2.5 text-sm"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${f.type === 'IN' ? (f.late ? 'bg-late' : 'bg-good') : 'bg-slate-400'}`} />{f.message}</li>)}
                {feed.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">Waiting for the next card scan at the gate.</li>}
              </ul>
            </Panel>
          </div>

          {changes > 0 && (
            <div className="sticky bottom-0 z-10 -mx-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-300 bg-white px-4 py-3 shadow-lg sm:mx-0 sm:rounded-lg sm:border">
              <span className="text-sm"><b>{changes}</b> change{changes > 1 ? 's' : ''} not saved yet</span>
              <div className="flex gap-2"><Button variant="outline" onClick={() => setDraft({})}>Undo</Button><Button disabled={busy} onClick={saveDraft}>{busy ? 'Saving…' : 'Save attendance'}</Button></div>
            </div>
          )}
        </>
      )}
      {holidays && <HolidayModal onClose={() => { setHolidays(false); load(); }} />}
    </div>
  );
}

/* ---------------- monthly report ---------------- */
function Monthly({ classes, onError }: { classes: string[]; onError: (m: string) => void }) {
  const now = new Date();
  const [cls, setCls] = useState('');
  const [month, setMonth] = useState(now.getMonth() + 1); const [year, setYear] = useState(now.getFullYear());
  const [page, setPage] = useState(1);
  const [r, setR] = useState<Rep | null>(null);
  const [sort, setSort] = useState('class'); const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    const p = new URLSearchParams({ month: String(month), year: String(year), page: String(page), limit: '50' });
    if (cls) p.set('class', cls);
    api<Rep>(`/api/attendance/report?${p}`).then((x) => { setR(x); onError(''); }).catch((e) => onError(e.message));
  }, [cls, month, year, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const k = sort as keyof Rep['data'][number];
    const x = [...(r?.data ?? [])].sort((a, b) => (typeof a[k] === 'number' ? (a[k] as number) - (b[k] as number) : String(a[k]).localeCompare(String(b[k]), undefined, { numeric: true })));
    return dir === 'asc' ? x : x.reverse();
  }, [r, sort, dir]);
  const onSort = (k: string) => { if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('asc'); } };
  const years = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Select value={cls} onChange={(e) => { setCls(e.target.value); setPage(1); }} aria-label="Class"><option value="">All classes</option>{classes.map((c) => <option key={c} value={c}>Class {c}</option>)}</Select>
        <Select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setPage(1); }} aria-label="Month">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
        <Select value={year} onChange={(e) => { setYear(Number(e.target.value)); setPage(1); }} aria-label="Year">{years.map((y) => <option key={y}>{y}</option>)}</Select>
        <Button variant="outline" disabled={!r} onClick={() => r && downloadCsv(`Attendance_${MONTHS[month - 1]}_${year}.csv`, ['Unique No', 'Name', 'Class', 'School days', 'Present', 'Late', 'Absent', '%'], list.map((x) => [x.unique_no, x.name, x.class, x.total_days, x.total_present_days, x.total_late_days, x.total_absent_days, x.percentage]))}>Download CSV</Button>
      </div>
      {r && <p className="text-sm text-slate-600">School days in {MONTHS[month - 1]} {year} so far: <b>{r.total_days_in_month}</b>{r.holidays.length > 0 && <> · Holidays: {r.holidays.map((h) => `${nice(h.date)} (${h.name})`).join(', ')}</>}</p>}
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50"><tr>
              <SortTh label="Unique No" k="unique_no" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Name" k="name" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Class" k="class" sort={sort} dir={dir} onSort={onSort} />
              <th className={th}>School days</th><SortTh label="Present" k="total_present_days" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Late" k="total_late_days" sort={sort} dir={dir} onSort={onSort} />
              <SortTh label="Absent" k="total_absent_days" sort={sort} dir={dir} onSort={onSort} /><SortTh label="%" k="percentage" sort={sort} dir={dir} onSort={onSort} />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((x) => (
                <tr key={x.student_id}><td className={td}>{x.unique_no}</td><td className={`${td} font-medium`}>{x.name}</td><td className={td}>{x.class}</td><td className={td}>{x.total_days}</td>
                  <td className={`${td} text-good`}>{x.total_present_days}</td><td className={`${td} text-late`}>{x.total_late_days}</td><td className={`${td} text-bad`}>{x.total_absent_days}</td>
                  <td className={`${td} font-semibold ${x.percentage < 75 ? 'text-bad' : ''}`}>{x.percentage}%</td></tr>
              ))}
              {r && list.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">No students.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={page} limit={50} total={r?.total ?? 0} onPage={setPage} />
      </Panel>
    </div>
  );
}

/* ---------------- holidays + weekly off ---------------- */
function HolidayModal({ onClose }: { onClose: () => void }) {
  const [off, setOff] = useState<number[]>([]);
  const [list, setList] = useState<{ id: string; date: string; name: string }[]>([]);
  const [date, setDate] = useState(todayStr()); const [name, setName] = useState('');
  const [error, setError] = useState('');
  const load = () => api<{ weekly_off: number[]; data: { id: string; date: string; name: string }[] }>('/api/attendance/holidays').then((r) => { setOff(r.weekly_off); setList(r.data); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const run = async (f: () => Promise<unknown>) => { setError(''); try { await f(); await load(); } catch (e: any) { setError(e.message); } };
  return (
    <Modal title="Holidays & weekly off" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">These days are not counted in "school days" of a month. A day on which students were marked present always counts.</p>
      <ErrorText>{error}</ErrorText>
      <p className="mb-1 text-sm font-semibold">Weekly off</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {DAYS.map((n, i) => (
          <button type="button" key={n} role="checkbox" aria-checked={off.includes(i)} onClick={() => run(() => api('/api/attendance/weekly-off', { method: 'PUT', body: { days: off.includes(i) ? off.filter((x) => x !== i) : [...off, i] } }))}
            className={`h-9 rounded-md border px-3 text-sm font-semibold ${off.includes(i) ? 'border-board bg-board text-white' : 'border-slate-300 bg-white'}`}>{n.slice(0, 3)}</button>
        ))}
      </div>
      <p className="mb-1 text-sm font-semibold">Add a holiday</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" aria-label="Holiday date" /><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Diwali)" className="min-w-0 flex-1" aria-label="Holiday name" />
        <Button onClick={() => run(async () => { await api('/api/attendance/holidays', { body: { date, name } }); setName(''); })}>Add</Button>
      </div>
      <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
        {list.map((h) => <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span>{nice(h.date)} · {h.name}</span><button className="text-bad" onClick={() => run(() => api(`/api/attendance/holidays/${h.id}`, { method: 'DELETE' }))}>Remove</button></li>)}
        {list.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No holidays added.</li>}
      </ul>
    </Modal>
  );
}
