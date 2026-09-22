import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../auth/auth.middleware';

export const highlightsRouter = Router();
highlightsRouter.use(requireAuth);

const updateHighlightSchema = z.object({
  startTime: z.number().min(0).optional(),
  endTime: z.number().positive().optional(),
  userStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

highlightsRouter.get('/:id', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const highlight = await prisma.highlight.findFirst({
    where: {
      id,
      video: { userId },
      deleted: false,
    },
    include: { video: true },
  });

  if (!highlight) {
    res.status(404).json({ error: 'Highlight not found' });
    return;
  }

  res.status(200).json({ highlight });
});

highlightsRouter.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;
  const parsed = updateHighlightSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.highlight.findFirst({
    where: { id, video: { userId }, deleted: false },
  });
  if (!existing) {
    res.status(404).json({ error: 'Highlight not found' });
    return;
  }

  const updated = await prisma.highlight.update({
    where: { id },
    data: {
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      userStatus: parsed.data.userStatus,
    },
  });

  res.status(200).json({ highlight: updated });
});

highlightsRouter.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const existing = await prisma.highlight.findFirst({
    where: { id, video: { userId }, deleted: false },
  });
  if (!existing) {
    res.status(404).json({ error: 'Highlight not found' });
    return;
  }

  await prisma.highlight.update({
    where: { id },
    data: { deleted: true },
  });

  res.status(204).send();
});
