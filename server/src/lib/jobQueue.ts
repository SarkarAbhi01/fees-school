// PostgreSQL job queue + setInterval worker (every 10s, 5 jobs). No BullMQ / Redis.
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export async function enqueue(type: 'WHATSAPP' | 'RECEIPT', payload: Prisma.InputJsonValue, school_id?: string) {
  await prisma.jobQueue.create({ data: { type, payload, school_id } });
}

async function sendWhatsapp(p: { phone: string; message: string }) {
  const url = process.env.WHATSAPP_API_URL;
  if (!url) { console.log(`[WHATSAPP:dry-run] ${p.phone}: ${p.message}`); return; }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN ?? ''}` },
    body: JSON.stringify({ to: p.phone, message: p.message }),
  });
  if (!r.ok) throw new Error(`WhatsApp API ${r.status}`);
}

async function handle(job: { type: string; payload: any }) {
  if (job.type === 'WHATSAPP') return sendWhatsapp(job.payload);
  if (job.type === 'RECEIPT') {
    const r = job.payload;
    return sendWhatsapp({
      phone: r.phone,
      message: `Fee received. Receipt ${r.receipt_no}: Rs ${r.amount_paid}${r.fee_type ? ` (${r.fee_type})` : ''} via ${r.payment_mode} for ${r.student_name}.`,
    });
  }
  throw new Error(`Unknown job type ${job.type}`);
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    // Atomically claim up to 5 jobs; SKIP LOCKED keeps it safe even with 2 server instances.
    const jobs = await prisma.$queryRaw<{ id: string; type: string; payload: any; attempts: number }[]>`
      UPDATE "JobQueue" SET status = 'PROCESSING', attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM "JobQueue"
        WHERE status = 'PENDING' AND run_at <= now()
        ORDER BY "createdAt" LIMIT 5
        FOR UPDATE SKIP LOCKED)
      RETURNING id, type, payload, attempts`;
    for (const job of jobs) {
      try {
        await handle(job);
        await prisma.jobQueue.update({ where: { id: job.id }, data: { status: 'DONE' } });
      } catch (e: any) {
        const failed = job.attempts >= 3;
        await prisma.jobQueue.update({
          where: { id: job.id },
          data: { status: failed ? 'FAILED' : 'PENDING', last_error: String(e?.message ?? e).slice(0, 500), run_at: new Date(Date.now() + 60000) },
        });
      }
    }
  } catch (e) {
    console.error('[jobs] tick error', e);
  } finally {
    running = false;
  }
}

export function startJobWorker() {
  setInterval(tick, 10000);
  // hourly housekeeping: unstick crashed jobs, purge old DONE rows
  setInterval(async () => {
    try {
      await prisma.$executeRaw`UPDATE "JobQueue" SET status='PENDING' WHERE status='PROCESSING' AND run_at < now() - interval '10 minutes'`;
      await prisma.$executeRaw`DELETE FROM "JobQueue" WHERE status='DONE' AND "createdAt" < now() - interval '7 days'`;
    } catch (e) { console.error('[jobs] cleanup error', e); }
  }, 3600000);
  console.log('[jobs] worker started (10s / 5 jobs)');
}
