import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error(err, 'Unhandled error');

  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.flatten(),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Unique constraint violation' });
      return;
    }
  }

  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === 'string' && msg.includes('Unauthorized')) {
      res.status(401).json({ error: msg });
      return;
    }
  }

  res.status(500).json({
    error: 'Internal server error',
  });
}
