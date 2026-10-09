import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../prisma';
import { authenticate, jwtSecret } from '../middleware/auth';
import { wrap } from '../lib/util';
import { cleanMenus } from '../lib/menus';

export const authRouter = Router();

authRouter.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (!user || !(await bcrypt.compare(String(password), user.password)))
    return res.status(401).json({ error: 'Invalid credentials' });

  let schoolName: string | null = null;
  let disabled: string[] = [];
  if (user.role !== 'SUPER_ADMIN') {
    const school = user.school_id
      ? await prisma.school.findUnique({ where: { id: user.school_id }, select: { name: true, is_active: true, disabled_menus: true } })
      : null;
    if (!school?.is_active) return res.status(403).json({ error: 'School is inactive. Contact support.' });
    schoolName = school.name;
    disabled = cleanMenus(school.disabled_menus);
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, role: user.role, school_id: user.school_id },
    jwtSecret(),
    { expiresIn: '12h' } as SignOptions,
  );
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, school_id: user.school_id, school_name: schoolName, disabled_menus: disabled } });
}));

authRouter.post('/change-password', authenticate(), wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body ?? {};
  if (!oldPassword || !newPassword || String(newPassword).length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user || !(await bcrypt.compare(String(oldPassword), user.password)))
    return res.status(400).json({ error: 'Old password is incorrect' });

  await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(String(newPassword), 10) } });
  res.json({ message: 'Password changed' });
}));

/** Fresh menu switches (set by the super admin) without signing in again. */
authRouter.get('/me', authenticate(), wrap(async (req, res) => {
  const u = req.user!;
  if (u.role === 'SUPER_ADMIN' || !u.school_id) return res.json({ school_name: null, disabled_menus: [] });
  const s = await prisma.school.findUnique({ where: { id: u.school_id }, select: { name: true, disabled_menus: true } });
  res.json({ school_name: s?.name ?? null, disabled_menus: cleanMenus(s?.disabled_menus) });
}));
