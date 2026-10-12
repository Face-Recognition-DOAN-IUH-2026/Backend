import { Response, NextFunction } from 'express';
import { AuthRequest, AuthConfig } from './types';
import { decodeToken } from './decodeToken';

function extractToken(req: AuthRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.split(' ')[1];
  }
  if (req.cookies?.access_token) {
    return req.cookies.access_token;
  }
  if (req.query?.token && typeof req.query.token === 'string') {
    return req.query.token;
  }
  return null;
}

export function createAuth(config: AuthConfig) {
  const key = config.errorKey || 'error';
  const noTokenMsg = config.noTokenMessage || 'No token provided';
  const invalidTokenMsg = config.invalidTokenMessage || 'Invalid or expired token';
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ [key]: noTokenMsg });
      return;
    }
    try {
      const user = decodeToken(token, config);
      req.user = { ...user, token };
      next();
    } catch {
      res.status(401).json({ [key]: invalidTokenMsg });
    }
  };
}
