import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../auth/auth.middleware';
import { createExportQueue, enqueueExportJob } from '../../jobs/queue';

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

const createExportSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(['INDIVIDUAL', 'MERGE']),
  format: z.enum(['MP4_HD', 'MP4_FULL_HD', 'MP4_4K']).default('MP4_FULL_HD'),
  highlightIds: z.array(z.string().min(1)).nonempty(),
});

exportsRouter.post('/', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const parsed = createExportSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const { projectId, type, format, highlightIds } = parsed.data;

  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const highlights = await prisma.highlight.findMany({
    where: {
      id: { in: highlightIds },
      video: { projectId, userId },
      deleted: false,
    },
    orderBy: { eventTime: 'asc' },
  });

  if (highlights.length !== highlightIds.length) {
    res.status(400).json({ error: 'Some highlights not found' });
    return;
  }

  const exportRecord = await prisma.export.create({
    data: {
      projectId,
      userId,
      type,
      format,
      status: 'QUEUED',
      exportItems: {
        create: highlights.map((h, idx) => ({
          highlightId: h.id,
          orderIndex: idx,
          startTime: h.startTime,
          endTime: h.endTime,
        })),
      },
    },
    include: { exportItems: true },
  });

  const queue = createExportQueue();
  try {
    await enqueueExportJob(queue, {
      exportId: exportRecord.id,
      projectId,
      userId,
    });
  } finally {
    await queue.close();
  }

  res.status(202).json({ export: exportRecord });
});

exportsRouter.get('/:id', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const exportRecord = await prisma.export.findFirst({
    where: { id, userId },
    include: { exportItems: true },
  });

  if (!exportRecord) {
    res.status(404).json({ error: 'Export not found' });
    return;
  }

  let downloadUrl: string | null = null;
  if (exportRecord.status === 'EXPORTED' && exportRecord.storageKey) {
    downloadUrl = `https://storage.example.com/presigned-download/${exportRecord.storageKey}`;
  }

  res.status(200).json({ export: exportRecord, downloadUrl });
});
