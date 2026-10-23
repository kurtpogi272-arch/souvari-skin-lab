import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import prisma from '../config/database';

async function isCurrentSession(payload: TokenPayload): Promise<boolean> {
  const user = await prisma.users.findUnique({
    where: { id: payload.userId },
    select: { status: true, deleted_at: true, auth_version: true, role: true },
  });
  return !!user && user.status === 'active' && !user.deleted_at &&
    user.auth_version === (payload.authVersion ?? 0) && user.role === payload.role;
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload: TokenPayload = verifyAccessToken(token);
    if (!await isCurrentSession(payload)) {
      res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const payload = verifyAccessToken(token);
      if (await isCurrentSession(payload)) req.user = payload;
    } catch {
      // Token invalid — proceed without user
    }
  }
  next();
}
