import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { dateStr } from './time';

/**
 * Attendance counts for a date. Only ACTIVE students of this school (optionally one class), each student once,
 * so the numbers can never exceed total students. The date is compared as a DATE (not a timestamp) so the DB
 * time zone cannot shift the day.
 *   present = PRESENT + LATE   (a late student is still in school)
 *   late    = LATE only         (shown as its own count)
 */
export async function attendanceCounts(sid: string, date: Date, cls?: string) {
  const classCond = cls ? Prisma.sql`AND s.class = ${cls}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ present: bigint; late: bigint }[]>`
    SELECT count(DISTINCT a.student_id) FILTER (WHERE a.status IN ('PRESENT','LATE')) AS present,
           count(DISTINCT a.student_id) FILTER (WHERE a.status = 'LATE') AS late
    FROM "Attendance" a JOIN "Student" s ON s.id = a.student_id
    WHERE a.school_id = ${sid} AND s.school_id = ${sid} AND s.is_active = true
      AND a.date = ${dateStr(date)}::date ${classCond}`;
  return { present: Number(rows[0]?.present ?? 0), late: Number(rows[0]?.late ?? 0) };
}

export const countPresent = async (sid: string, date: Date, cls?: string) => (await attendanceCounts(sid, date, cls)).present;
