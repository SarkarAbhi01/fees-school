import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

export interface AuthUser { id: string; name: string; role: string; school_id: string | null }
declare global { namespace Express { interface Request { user?: AuthUser } } }

export const jwtSecret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET missing in .env');
  return s;
};

// tiny native TTL cache: a deactivated school is blocked within 60s without a DB hit per request
const activeCache = new Map<string, { v: boolean; exp: number }>();
export const invalidateSchool = (id: string) => activeCache.delete(id);

async function schoolActive(id: string) {
  const hit = activeCache.get(id);
  if (hit && hit.exp > Date.now()) return hit.v;
  const s = await prisma.school.findUnique({ where: { id }, select: { is_active: true } });
  const v = !!s?.is_active;
  activeCache.set(id, { v, exp: Date.now() + 60000 });
  return v;
}

/** allowQuery: EventSource cannot send headers, so SSE passes ?token=... */
export const authenticate = (opts: { allowQuery?: boolean } = {}) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      let token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (!token && opts.allowQuery && typeof req.query.token === 'string') token = req.query.token;
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const user = jwt.verify(token, jwtSecret()) as AuthUser;
      if (user.role !== 'SUPER_ADMIN') {
        if (!user.school_id || !(await schoolActive(user.school_id)))
          return res.status(403).json({ error: 'School is inactive' });
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };

export const requireRole = (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

/** UHF reader hardware has no login: protect /scan with a shared key header. */
export const readerKey = (req: Request, res: Response, next: NextFunction) => {
  const key = process.env.READER_API_KEY;
  if (key && req.headers['x-reader-key'] !== key) return res.status(401).json({ error: 'Invalid reader key' });
  next();
};
