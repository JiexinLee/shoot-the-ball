import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../auth/auth.middleware';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

jobsRouter.get('/:id', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const job = await prisma.processingJob.findFirst({
    where: { id, userId },
  });

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.status(200).json({ job });
});

jobsRouter.get('/:id/events', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const job = await prisma.processingJob.findFirst({
    where: { id, userId },
  });

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`event: progress\n`);
  res.write(`data: ${JSON.stringify({ jobId: id, stage: job.stage ?? 'Preparing', progress: job.progress })}\n\n`);

  if (job.status === 'READY') {
    res.write(`event: completed\n`);
    res.write(`data: ${JSON.stringify({ jobId: id, status: 'Ready' })}\n\n`);
    res.end();
    return;
  }

  if (job.status === 'FAILED') {
    res.write(`event: failed\n`);
    res.write(`data: ${JSON.stringify({ jobId: id, error: job.errorMessage ?? 'Unknown error' })}\n\n`);
    res.end();
    return;
  }

  req.on('close', () => {
    res.end();
  });
});
