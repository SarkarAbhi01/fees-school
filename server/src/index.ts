import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { prisma } from './prisma';
import { authRouter } from './routes/auth';
import { superAdminRouter } from './routes/superadmin';
import { attendanceRouter } from './routes/attendance';
import { studentsRouter } from './routes/students';
import { feesRouter } from './routes/fees';
import { feeReportsRouter } from './routes/feeReports';
import { dashboardRouter } from './routes/dashboard';
import { backupRouter } from './routes/backup';
import { startBackupScheduler } from './lib/backup';
import { startJobWorker } from './lib/jobQueue';
import { migrateLegacyFees } from './lib/legacy';
import { HttpError } from './lib/util';

const app = express();
app.disable('x-powered-by');
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/superadmin', superAdminRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/students', studentsRouter);
app.use('/api/fees', feeReportsRouter);
app.use('/api/fees', feesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/backup', backupRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Single-project deploy: Express serves the built React app (run `npm run build` first).
const clientDist = path.join(process.cwd(), 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.message?.startsWith('Invalid date')) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => {
  console.log(`School ERP running on http://localhost:${port}`);
  startJobWorker();
  startBackupScheduler();
  migrateLegacyFees().catch((e) => console.error('Legacy fee conversion failed:', e));
});

const shutdown = async () => { server.close(); await prisma.$disconnect(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
