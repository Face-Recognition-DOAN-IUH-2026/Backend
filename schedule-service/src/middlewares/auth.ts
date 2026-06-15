import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
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
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }
  try {
    const decoded: any = jwt.verify(header.split(' ')[1], config.jwtSecret, {
      audience: config.jwtAudience,
      issuer: config.jwtIssuer,
    });
    req.user = {
      userId: decoded.sub,
      email: decoded.email || '',
      role: decoded.roles?.[0] || 'user',
      fullName: decoded.full_name || null,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
