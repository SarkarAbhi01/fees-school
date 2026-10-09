import { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 4 does not catch async errors, so wrap every async handler. */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

/** Hard cap of 50 rows per page keeps RAM flat no matter how many students exist. */
export function pageParams(req: Request) {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  return { page, limit, skip: (page - 1) * limit };
}

export const schoolId = (req: Request) => req.user!.school_id as string;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Natural class order: 1, 2, ... 10, 11, 12, then text like LKG/UKG. */
export const classSort = (a: string, b: string) => {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a.localeCompare(b);
};
