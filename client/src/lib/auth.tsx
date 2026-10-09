import { createContext, ReactNode, useContext, useState } from 'react';
import { api } from './api';
import { menuOfPath, menuOn } from './menus';

export interface User { id: string; name: string; email: string; role: string; school_id: string | null; school_name: string | null; disabled_menus?: string[] }
interface Ctx {
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem('user') ?? 'null'); } catch { return null; }
  });

  async function login(email: string, password: string) {
    const res = await api<{ token: string; user: User }>('/api/auth/login', { body: { email, password } });
    localStorage.setItem('token', res.token);
    localStorage.setItem('user', JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  }
  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }
  /** Picks up menu switches the super admin changed, without signing in again. */
  async function refresh() {
    if (!user || user.role === 'SUPER_ADMIN') return;
    try {
      const me = await api<{ school_name: string | null; disabled_menus: string[] }>('/api/auth/me');
      const next = { ...user, school_name: me.school_name ?? user.school_name, disabled_menus: me.disabled_menus };
      if (JSON.stringify(next) !== JSON.stringify(user)) { localStorage.setItem('user', JSON.stringify(next)); setUser(next); }
    } catch { /* the api helper already signs out on 401 */ }
  }
  return <AuthCtx.Provider value={{ user, login, logout, refresh }}>{children}</AuthCtx.Provider>;
}

/** Landing page after login, per role. */
export const homeFor = (role?: string, disabled: string[] = []) => {
  if (role === 'SUPER_ADMIN') return '/superadmin';
  const order = role === 'FEES_COLLECTOR' ? ['/fees/collect'] : ['/dashboard', '/attendance', '/students', '/fees/collect', '/fees/records', '/fees/reports', '/backup'];
  return order.find((p) => menuOn(disabled, menuOfPath(p) ?? '')) ?? '/change-password';
};
