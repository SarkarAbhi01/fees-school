import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { menuOn } from '../lib/menus';
import { api, rupees } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Panel } from '../components/ui';

interface Stats { total_students: number; today_present: number; today_late: number; today_absent: number; today_fees_collected: number }

export default function Dashboard() {
  const { user } = useAuth();
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api<Stats>('/api/dashboard/stats').then(setS).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const items = [
    { label: 'Present today (incl. late)', value: s?.today_present, color: 'text-good' },
    { label: 'Late today', value: s?.today_late, color: 'text-late' },
    { label: 'Absent today', value: s?.today_absent, color: 'text-bad' },
    { label: 'Total students', value: s?.total_students, color: 'text-ink' },
    ...(user?.role === 'SCHOOL_ADMIN' ? [{ label: 'Fees collected today', value: s ? rupees(s.today_fees_collected) : undefined, color: 'text-board' }] : []),
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Today at {user?.school_name}</h1>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className={`grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 ${items.length > 4 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        {items.map((i) => (
          <div key={i.label} className="bg-white p-6">
            <p className="text-sm text-slate-500">{i.label}</p>
            <p className={`mt-2 font-display text-4xl font-bold ${i.color}`}>{i.value ?? '…'}</p>
          </div>
        ))}
      </div>
      <Panel className="p-5">
        <p className="mb-3 font-semibold">Jump to</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {menuOn(user?.disabled_menus, 'attendance') && <Link className="rounded-md bg-board px-4 py-2 font-semibold text-white" to="/attendance">Watch the gate live</Link>}
          {user?.role === 'SCHOOL_ADMIN' && menuOn(user?.disabled_menus, 'fees.collect') && <Link className="rounded-md bg-board px-4 py-2 font-semibold text-white" to="/fees/collect">Collect a fee</Link>}
          {menuOn(user?.disabled_menus, 'students') && <Link className="rounded-md border border-slate-300 px-4 py-2 font-semibold" to="/students">Find a student</Link>}
        </div>
      </Panel>
    </div>
  );
}
