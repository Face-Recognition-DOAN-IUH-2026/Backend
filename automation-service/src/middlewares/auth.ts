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

export function decodeToken(token: string) {
  const decoded: any = jwt.verify(token, config.jwtSecret, {
    audience: config.jwtAudience,
    issuer: config.jwtIssuer,
  });
  return {
    userId: decoded.sub,
    email: decoded.email || '',
    role: decoded.roles?.[0] || decoded.role || 'user',
    fullName: decoded.full_name || decoded.fullName || null,
  };
}

export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }
  try {
    req.user = decodeToken(header.split(' ')[1]);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role || '';
    if (!roles.includes(role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
