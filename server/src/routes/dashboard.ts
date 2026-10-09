import { Router } from 'express';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { localDateOnly, startOfLocalDay } from '../lib/time';
import { attendanceCounts } from '../lib/presence';
import { schoolId, wrap } from '../lib/util';

export const dashboardRouter = Router();

dashboardRouter.get('/stats', authenticate(), requireRole('SCHOOL_ADMIN', 'TEACHER'), wrap(async (req, res) => {
  const sid = schoolId(req);
  const [total_students, counts, fees] = await Promise.all([
    prisma.student.count({ where: { school_id: sid, is_active: true } }),
    attendanceCounts(sid, localDateOnly()),
    prisma.feePayment.aggregate({ where: { school_id: sid, payment_date: { gte: startOfLocalDay() } }, _sum: { amount_paid: true } }),
  ]);
  const today_present = Math.min(counts.present, total_students);
  res.json({
    total_students,
    today_present,                                   // on time + late
    today_late: Math.min(counts.late, today_present),  // late only
    today_absent: Math.max(total_students - today_present, 0),
    today_fees_collected: fees._sum.amount_paid ?? 0,
  });
}));
