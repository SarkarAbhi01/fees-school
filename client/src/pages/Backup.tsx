import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, ErrorText, Field, Input, Panel, Select, td, th } from '../components/ui';

interface Cfg {
  frequency: string; run_time: string; range: string; datasets: string[]; make_excel: boolean; make_json: boolean; make_bak: boolean; to_drive: boolean; keep_last: number;
  last_run_at: string | null; last_status: string; last_error: string;
}
interface Conf { scope: string; datasets_available: { key: string; label: string }[]; config: Cfg; drive: { configured: boolean; mode: string | null } }
interface File { id: string; kind: string; file_name: string; size: number; period: string; trigger: string; created_by: string; drive_status: string; drive_error: string; createdAt: string }

const RANGES: [string, string][] = [['ALL', 'All data'], ['DAY', "Today's data"], ['WEEK', "This week's data"], ['MONTH', "This month's data"], ['YEAR', "This financial year's data"]];
const FREQ: [string, string][] = [['OFF', 'Off'], ['DAILY', 'Every day'], ['WEEKLY', 'Every week (Sunday)'], ['MONTHLY', 'Every month (last day)'], ['YEARLY', 'Every year (31 March)']];
const KIND: Record<string, string> = { EXCEL: 'Excel', JSON: 'JSON', BAK: '.bak' };
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function Backup() {
  const { user } = useAuth();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const [params, setParams] = useSearchParams();
  const school = params.get('school') ?? '';
  const [schools, setSchools] = useState<{ id: string; name: string; code: string }[]>([]);
  const [conf, setConf] = useState<Conf | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState('');
  const [now, setNow] = useState({ range: 'ALL', datasets: [] as string[], make_excel: true, make_json: true, make_bak: true, to_drive: false });
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [error, setError] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState('');

  const qs = school ? `school_id=${school}` : '';
  const sep = (p: string) => `${p}${p.includes('?') ? '&' : '?'}${qs}`;

  useEffect(() => { if (isSuper) api<{ data: { id: string; name: string; code: string }[] }>('/api/superadmin/schools?limit=100&sort=name&dir=asc').then((r) => setSchools(r.data)).catch(() => {}); }, [isSuper]);
  const load = useCallback(async () => {
    try {
      const c = await api<Conf>(sep('/api/backup/config'));
      setConf(c); setCfg(c.config);
      setNow((n) => ({ ...n, datasets: n.datasets.length ? n.datasets : c.datasets_available.map((d) => d.key), to_drive: c.drive.configured ? n.to_drive : false }));
      setFiles((await api<{ data: File[] }>(sep(`/api/backup/files?kind=${kind}`))).data);
      setError('');
    } catch (e: any) { setError(e.message); }
  }, [school, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const flip = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const wrap = async (name: string, f: () => Promise<void>) => { setBusy(name); setError(''); setOk(''); try { await f(); } catch (e: any) { setError(e.message); } setBusy(''); };

  const runNow = () => wrap('run', async () => {
    const r = await api<{ files: File[] }>(sep('/api/backup/run'), { body: now });
    const failed = r.files.filter((f) => f.drive_status === 'FAILED');
    setOk(`${r.files.length} file${r.files.length > 1 ? 's' : ''} created.${now.to_drive ? (failed.length ? ` Google Drive upload failed: ${failed[0].drive_error}` : ' Copy sent to Google Drive.') : ''}`);
    await load();
  });
  const saveCfg = () => wrap('cfg', async () => { await api(sep('/api/backup/config'), { method: 'PUT', body: cfg }); setOk('Automatic backup saved.'); await load(); });
  const remove = (id: string) => { if (window.confirm('Delete this backup file from the server? A copy already sent to Google Drive stays there.')) wrap('del', async () => { await api(`/api/backup/files/${id}`, { method: 'DELETE' }); await load(); }); };
  const download = (f: File) => wrap('dl', () => downloadFile(`/api/backup/files/${f.id}/download`, f.file_name));

  const dsBoxes = (list: string[], set: (l: string[]) => void) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {conf?.datasets_available.map((d) => (
        <label key={d.key} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-board" checked={list.includes(d.key)} onChange={() => set(flip(list, d.key))} />{d.label}</label>
      ))}
    </div>
  );
  const typeBoxes = (v: { make_excel: boolean; make_json: boolean; make_bak: boolean; to_drive: boolean }, set: (p: Partial<typeof v>) => void) => (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-board" checked={v.make_excel} onChange={(e) => set({ make_excel: e.target.checked })} />Excel file (.xlsx, one sheet per table)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-board" checked={v.make_json} onChange={(e) => set({ make_json: e.target.checked })} />JSON file (.json)</label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-board" checked={v.make_bak} onChange={(e) => set({ make_bak: e.target.checked })} /><span>.bak file, a complete copy of {school || !isSuper ? "the school's data" : 'the whole database'} that can be restored (always everything, whatever is ticked above)</span></label>
      <label className={`flex items-start gap-2 text-sm ${conf?.drive.configured ? '' : 'text-slate-400'}`}><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-board" disabled={!conf?.drive.configured} checked={v.to_drive} onChange={(e) => set({ to_drive: e.target.checked })} /><span>Also keep one copy on Google Drive{!conf?.drive.configured && ' (not set up on the server yet, see README)'}</span></label>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">Backup</h1>
      {isSuper && (
        <Field label="Back up">
          <Select value={school} onChange={(e) => setParams(e.target.value ? { school: e.target.value } : {})} className="w-full sm:w-96" aria-label="Which data"><option value="">Whole platform (all schools)</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</Select>
        </Field>
      )}
      <ErrorText>{error}</ErrorText>
      {ok && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{ok}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="space-y-4 p-4 sm:p-5">
          <h2 className="font-bold">Back up now</h2>
          <div><p className="mb-2 text-sm font-semibold">What to include (Excel and JSON)</p>{dsBoxes(now.datasets, (datasets) => setNow({ ...now, datasets }))}</div>
          <Field label="Attendance and fee receipts of"><Select value={now.range} onChange={(e) => setNow({ ...now, range: e.target.value })}>{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <div><p className="mb-2 text-sm font-semibold">Files</p>{typeBoxes(now, (p) => setNow({ ...now, ...p }))}</div>
          <Button onClick={runNow} disabled={busy === 'run' || !conf}>{busy === 'run' ? 'Backing up… please wait' : 'Back up now'}</Button>
        </Panel>

        <Panel className="space-y-4 p-4 sm:p-5">
          <h2 className="font-bold">Automatic backup</h2>
          {cfg && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="How often"><Select value={cfg.frequency} onChange={(e) => setCfg({ ...cfg, frequency: e.target.value })}>{FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
                <Field label="Time (school time)"><Input type="time" value={cfg.run_time} onChange={(e) => setCfg({ ...cfg, run_time: e.target.value })} /></Field>
                <Field label="Attendance and receipts of"><Select value={cfg.range} onChange={(e) => setCfg({ ...cfg, range: e.target.value })}>{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
                <Field label="Keep last (per file type)"><Input type="number" min={1} max={365} value={cfg.keep_last} onChange={(e) => setCfg({ ...cfg, keep_last: Number(e.target.value) })} /></Field>
              </div>
              <div><p className="mb-2 text-sm font-semibold">What to include (Excel and JSON)</p>{dsBoxes(cfg.datasets, (datasets) => setCfg({ ...cfg, datasets }))}</div>
              <div><p className="mb-2 text-sm font-semibold">Files</p>{typeBoxes(cfg, (p) => setCfg({ ...cfg, ...p }))}</div>
              <Button onClick={saveCfg} disabled={busy === 'cfg'}>Save automatic backup</Button>
              <p className="text-xs text-slate-500">
                {cfg.last_run_at ? `Last run: ${when(cfg.last_run_at)} · ${cfg.last_status}` : 'Has not run yet.'}{cfg.last_error && <span className="text-bad"> · {cfg.last_error}</span>}
                <br />The server must be running at that time. If it was off, the backup runs when the server starts again.
              </p>
            </>
          )}
        </Panel>
      </div>

      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="font-bold">Backup files</h2>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="File type"><option value="">All types</option><option value="EXCEL">Excel</option><option value="JSON">JSON</option><option value="BAK">.bak</option></Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className={th}>Created</th><th className={th}>Type</th><th className={th}>File</th><th className={th}>Size</th><th className={th}>How</th><th className={th}>Google Drive</th><th className={th}></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {files.map((f) => (
                <tr key={f.id}>
                  <td className={td}>{when(f.createdAt)}</td><td className={td}>{KIND[f.kind]}</td><td className={`${td} break-all`}>{f.file_name}</td><td className={td}>{size(f.size)}</td>
                  <td className={td}>{f.trigger === 'AUTO' ? `Auto (${f.period.toLowerCase()})` : `Manual · ${f.created_by}`}</td>
                  <td className={td}>{f.drive_status === 'UPLOADED' ? <span className="text-good">Uploaded</span> : f.drive_status === 'FAILED' ? <span className="text-bad" title={f.drive_error}>Failed</span> : '—'}</td>
                  <td className={`${td} whitespace-nowrap`}><button className="mr-3 font-semibold text-board" onClick={() => download(f)}>Download</button><button className="text-bad" onClick={() => remove(f.id)}>Delete</button></td>
                </tr>
              ))}
              {files.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">No backups yet. Press "Back up now".</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
