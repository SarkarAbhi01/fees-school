import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '../lib/auth';
import { Button, ErrorText, Field, Input } from '../components/ui';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user.role, user.disabled_menus)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const u = await login(email, password);
      navigate(homeFor(u.role, u.disabled_menus), { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-board p-12 text-white lg:flex">
        <p className="font-display text-xl font-bold">School ERP</p>
        <div>
          <h1 className="max-w-md text-5xl font-bold leading-tight">Attendance at the gate. Fees at the desk.</h1>
          <p className="mt-5 max-w-sm text-white/70">One card per student, Class 1 to Class 12. Scan at the gate, and parents hear about it on WhatsApp.</p>
        </div>
        <p className="text-sm text-white/50">Works for every school on the platform, each with its own data.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <h2 className="text-2xl font-bold">Sign in</h2>
          <ErrorText>{error}</ErrorText>
          <Field label="Email"><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
          <p className="text-sm text-slate-600">
            Want to update your password? <Link to="/change-password" className="font-semibold text-board underline">Change password</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
