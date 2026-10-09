import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Button, ErrorText, Field, Input, Panel } from '../components/ui';

export default function ChangePassword() {
  const navigate = useNavigate();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) return setError('New password and confirmation do not match.');
    try {
      await api('/api/auth/change-password', { body: { oldPassword, newPassword } });
      setDone(true); setOld(''); setNew(''); setConfirm('');
    } catch (err: any) { setError(err.message); }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Change password</h1>
      <Panel className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <ErrorText>{error}</ErrorText>
          {done && <p className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">Password changed. Use the new one next time you sign in.</p>}
          <Field label="Old password"><Input type="password" required value={oldPassword} onChange={(e) => setOld(e.target.value)} /></Field>
          <Field label="New password (at least 6 characters)"><Input type="password" required minLength={6} value={newPassword} onChange={(e) => setNew(e.target.value)} /></Field>
          <Field label="Confirm new password"><Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <div className="flex gap-2">
            <Button type="submit">Save password</Button>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>Back</Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
