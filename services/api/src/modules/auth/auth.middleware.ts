import { Request, Response, NextFunction } from 'express';
import { extractBearerToken, verifyToken } from '../auth/jwt';
import { prisma } from '../../db/prisma';

declare global {
  namespace Express {
    interface Request {
      currentUser?: {
        id: string;
        email: string;
        name: string;
      };
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized: missing token' });
    return;
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      res.status(401).json({ error: 'Unauthorized: user not found' });
      return;
    }

    req.currentUser = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: invalid token' });
  }
}
