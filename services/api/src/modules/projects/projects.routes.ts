import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../auth/auth.middleware';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const createProjectSchema = z.object({
  name: z.string().min(1).max(128),
  coverUrl: z.string().url().optional().nullable(),
});

projectsRouter.post('/', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const project = await prisma.project.create({
    data: {
      userId,
      name: parsed.data.name,
      coverUrl: parsed.data.coverUrl ?? null,
    },
  });

  res.status(201).json({ project });
});

projectsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
  res.status(200).json({ projects });
});

projectsRouter.get('/:id', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const project = await prisma.project.findFirst({
    where: { id, userId },
    include: {
      videos: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  res.status(200).json({ project });
});

projectsRouter.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;
  const parsed = createProjectSchema.partial().safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const exists = await prisma.project.findFirst({ where: { id, userId } });
  if (!exists) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const project = await prisma.project.update({
    where: { id },
    data: parsed.data,
  });

  res.status(200).json({ project });
});

projectsRouter.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const exists = await prisma.project.findFirst({ where: { id, userId } });
  if (!exists) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  await prisma.project.delete({ where: { id } });
  res.status(204).send();
});
