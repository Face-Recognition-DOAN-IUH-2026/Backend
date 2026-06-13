import { Request, Response, NextFunction } from 'express';
import { authService } from '../services';
import { config } from '../config';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
    fullName?: string | null;
  };
}

export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const internalKey = req.headers['x-internal-api-key'] as string | undefined;
  if (internalKey && internalKey === config.internalApiKey) {
    req.user = { userId: '', email: '', role: 'admin', fullName: 'internal' };
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const token = authHeader.split(' ')[1];
    const payload = authService.verifyToken(token, 'access');
    req.user = payload;
    next();
  } catch (error: any) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
