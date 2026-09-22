import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../auth/auth.middleware';
import { createProcessingQueue, enqueueProcessingJob } from '../../jobs/queue';

export const videosRouter = Router();
videosRouter.use(requireAuth);

const uploadSessionSchema = z.object({
  projectId: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
});

const completeUploadSchema = z.object({
  duration: z.number().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
});

const calibrationSchema = z.object({
  hoopRoi: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  courtRoi: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .nullable(),
});

videosRouter.post('/upload-session', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const parsed = uploadSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const { projectId, filename, contentType, size } = parsed.data;
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const storageKey = `videos/${projectId}/${Date.now()}-${filename}`;
  const video = await prisma.video.create({
    data: {
      projectId,
      userId,
      title: filename,
      filename,
      storageKey,
      contentType,
      sizeBytes: BigInt(size),
      status: 'UPLOADING',
    },
  });

  res.status(201).json({
    videoId: video.id,
    storageKey,
    uploadUrl: `https://storage.example.com/presigned-upload/${video.id}`,
  });
});

videosRouter.post('/:id/complete', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;
  const parsed = completeUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const video = await prisma.video.findFirst({ where: { id, userId } });
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  const updated = await prisma.video.update({
    where: { id },
    data: {
      status: 'UPLOADED',
      duration: parsed.data.duration,
      width: parsed.data.width,
      height: parsed.data.height,
      fps: parsed.data.fps,
      sourceUrl: `s3://source/${video.storageKey}`,
    },
  });

  res.status(200).json({ video: updated });
});

videosRouter.post('/:id/calibration', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;
  const parsed = calibrationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const video = await prisma.video.findFirst({ where: { id, userId } });
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  const updated = await prisma.video.update({
    where: { id },
    data: {
      calibration: {
        hoopRoi: parsed.data.hoopRoi,
        courtRoi: parsed.data.courtRoi ?? null,
      },
    },
  });

  res.status(200).json({ video: updated });
});

videosRouter.post('/:id/process', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const video = await prisma.video.findFirst({ where: { id, userId } });
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  if (video.status !== 'UPLOADED' && video.status !== 'FAILED') {
    res.status(409).json({ error: `Video is in status ${video.status}, cannot process` });
    return;
  }

  const queue = createProcessingQueue();
  try {
    const jobId = await enqueueProcessingJob(queue, {
      videoId: id,
      projectId: video.projectId,
      userId,
    });
    res.status(202).json({ jobId });
  } finally {
    await queue.close();
  }
});

videosRouter.get('/:id/highlights', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const video = await prisma.video.findFirst({ where: { id, userId } });
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  const highlights = await prisma.highlight.findMany({
    where: { videoId: id, deleted: false },
    orderBy: { eventTime: 'asc' },
  });

  res.status(200).json({ highlights });
});

videosRouter.get('/:id', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const video = await prisma.video.findFirst({
    where: { id, userId },
    include: { processingJob: true },
  });

  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  res.status(200).json({ video });
});
