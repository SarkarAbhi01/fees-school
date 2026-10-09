import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { menuOn } from '../lib/menus';
import { cn } from './ui';

interface NavItem { to: string; label: string; roles: string[]; key?: string; children?: { to: string; label: string; roles: string[]; key: string }[] }
const nav: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', roles: ['SCHOOL_ADMIN', 'TEACHER'], key: 'dashboard' },
  { to: '/attendance', label: 'Attendance', roles: ['SCHOOL_ADMIN', 'TEACHER'], key: 'attendance' },
  { to: '/students', label: 'Students', roles: ['SCHOOL_ADMIN', 'TEACHER'], key: 'students' },
  {
    to: '/fees', label: 'Fees', roles: ['SCHOOL_ADMIN', 'FEES_COLLECTOR'], key: 'fees',
    children: [
      { to: '/fees/collect', label: 'Collect Fee', roles: ['SCHOOL_ADMIN', 'FEES_COLLECTOR'], key: 'fees.collect' },
      { to: '/fees/records', label: 'Fee Records', roles: ['SCHOOL_ADMIN', 'FEES_COLLECTOR'], key: 'fees.records' },
      { to: '/fees/reports', label: 'Fee Reports', roles: ['SCHOOL_ADMIN', 'FEES_COLLECTOR'], key: 'fees.reports' },
      { to: '/fees/heads', label: 'Fee Heads', roles: ['SCHOOL_ADMIN'], key: 'fees.heads' },
      { to: '/fees/structure', label: 'Fee Structure', roles: ['SCHOOL_ADMIN', 'FEES_COLLECTOR'], key: 'fees.structure' },
      { to: '/fees/months', label: 'Fee Months', roles: ['SCHOOL_ADMIN'], key: 'fees.months' },
      { to: '/fees/late', label: 'Due Date & Late Fee', roles: ['SCHOOL_ADMIN'], key: 'fees.late' },
      { to: '/fees/custom', label: 'Custom Fees', roles: ['SCHOOL_ADMIN'], key: 'fees.custom' },
      { to: '/fees/discounts', label: 'Discounts', roles: ['SCHOOL_ADMIN'], key: 'fees.discounts' },
      { to: '/fees/discount-report', label: 'Discount Report', roles: ['SCHOOL_ADMIN'], key: 'fees.discount_report' },
      { to: '/fees/collectors', label: 'Fee Collectors', roles: ['SCHOOL_ADMIN'], key: 'fees.collectors' },
    ],
  },
  { to: '/backup', label: 'Backup', roles: ['SCHOOL_ADMIN'], key: 'backup' },
  { to: '/superadmin', label: 'Schools', roles: ['SUPER_ADMIN'] },
  { to: '/superadmin/analytics', label: 'Analytics', roles: ['SUPER_ADMIN'] },
  { to: '/superadmin/backup', label: 'Backup', roles: ['SUPER_ADMIN'] },
];

/**
 * Phones cannot show wide tables, so every table below 640px turns into stacked cards. The column names are copied
 * onto each cell (data-label) here, so no page needs to be changed. Add class "no-stack" to a table to opt out.
 */
function useStackedTables(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const label = () => {
      el.querySelectorAll('table:not(.no-stack)').forEach((t) => {
        t.classList.add('stack');
        const heads = Array.from(t.querySelectorAll('thead th')).map((h) => (h.textContent ?? '').replace(/[↕▲▼]/g, '').trim());
        t.querySelectorAll('tbody tr').forEach((tr) => {
          Array.from(tr.children).forEach((c, i) => { if (c.tagName === 'TD' && !c.hasAttribute('colspan') && c.getAttribute('data-label') !== heads[i]) c.setAttribute('data-label', heads[i] ?? ''); });
        });
      });
    };
    let raf = 0;
    const obs = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(label); });
    obs.observe(el, { childList: true, subtree: true });
    label();
    return () => { obs.disconnect(); cancelAnimationFrame(raf); };
  }, [root]);
}

export default function Layout() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  useStackedTables(mainRef);

  // close the phone menu after choosing a page; pick up menu switches made by the super admin
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const t = setInterval(refresh, 120000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = nav.filter((n) => user && n.roles.includes(user.role) && (!n.key || menuOn(user.disabled_menus, n.key)));
  const linkCls = (isActive: boolean) => cn('block rounded-md px-3 py-2.5 text-sm font-medium', isActive ? 'bg-white text-board' : 'text-white/80 hover:bg-white/10');
  const signOut = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen lg:flex">
      {/* top bar on phones and tablets */}
      <header className="no-print sticky top-0 z-20 flex items-center justify-between bg-board px-4 py-3 text-white lg:hidden" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold leading-tight">{user?.school_name ?? 'School ERP'}</p>
          <p className="truncate text-xs text-white/60">{user?.role === 'SUPER_ADMIN' ? 'Platform admin' : user?.name}</p>
        </div>
        <button onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open} className="ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/10 text-2xl">{open ? '×' : '☰'}</button>
      </header>
      {open && <button aria-label="Close menu" onClick={() => setOpen(false)} className="no-print fixed inset-0 z-20 bg-ink/50 lg:hidden" />}

      <aside className={cn(
        'no-print z-30 flex w-72 max-w-[85vw] flex-col bg-board text-white transition-transform',
        'fixed inset-y-0 left-0 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:max-w-none lg:translate-x-0 lg:shrink-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="hidden px-5 py-4 lg:block">
          <p className="font-display text-lg font-bold leading-tight">{user?.school_name ?? 'School ERP'}</p>
          <p className="text-xs text-white/60">{user?.role === 'SUPER_ADMIN' ? 'Platform admin' : user?.name}</p>
        </div>
        <div className="px-5 pb-2 pt-5 lg:hidden"><p className="font-display text-lg font-bold">{user?.school_name ?? 'School ERP'}</p></div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
          {items.map((n) => {
            const subs = (n.children ?? []).filter((c) => user && c.roles.includes(user.role) && menuOn(user.disabled_menus, c.key));
            if (n.children && !subs.length) return null;
            if (!n.children) return (
              <NavLink key={n.to} to={n.to} end={n.to === '/superadmin'} className={({ isActive }) => linkCls(isActive)}>{n.label}</NavLink>
            );
            const isOpen = pathname === n.to || pathname.startsWith(`${n.to}/`);
            return (
              <div key={n.to} className="space-y-1">
                <NavLink to={subs[0].to} className={() => linkCls(false) + (isOpen ? ' bg-white/10 text-white' : '')}>{n.label}</NavLink>
                {isOpen && subs.map((c) => (
                  <NavLink key={c.to} to={c.to} className={({ isActive }) => cn(linkCls(isActive), 'ml-4 py-2')}>{c.label}</NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-white/10 px-3 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <button onClick={() => navigate('/change-password')} className="w-full rounded-md px-3 py-2.5 text-left text-sm text-white/80 hover:bg-white/10">Change password</button>
          <button onClick={signOut} className="w-full rounded-md px-3 py-2.5 text-left text-sm text-white/80 hover:bg-white/10">Sign out</button>
        </div>
      </aside>
      <main ref={mainRef} className="min-w-0 flex-1 p-3 sm:p-5 lg:p-8"><Outlet /></main>
    </div>
  );
}
