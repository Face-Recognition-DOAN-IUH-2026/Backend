import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ detail: 'Invalid or expired token' });
    return;
  }
  try {
    const decoded: any = jwt.verify(header.slice(7), config.jwtSecret, {
      audience: config.jwtAudience,
      issuer: config.jwtIssuer,
    });
    req.user = {
      id: decoded.sub,
      email: decoded.email || '',
      role: decoded.roles?.[0] || decoded.role || '',
    };
    next();
  } catch {
    res.status(401).json({ detail: 'Invalid or expired token' });
  }
}

export function requireRole(roles: string[], detail: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ detail });
      return;
    }
    next();
  };
}
