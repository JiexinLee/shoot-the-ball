import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { signToken } from './jwt';
import { requireAuth } from './auth.middleware';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).max(64),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

authRouter.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const { email, password, name } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: password,
      name,
    },
  });

  const token = signToken(user.id);

  res.status(201).json({
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    token,
  });
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.passwordHash !== password) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signToken(user.id);
  res.status(200).json({
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    token,
  });
});

authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  if (!req.currentUser) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.status(200).json({ user: req.currentUser });
});
