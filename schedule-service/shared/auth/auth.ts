import { Response, NextFunction } from 'express';
import { AuthRequest, AuthConfig } from './types';
import { decodeToken } from './decodeToken';

export function createAuth(config: AuthConfig) {
  const key = config.errorKey || 'error';
  const noTokenMsg = config.noTokenMessage || 'No token provided';
  const invalidTokenMsg = config.invalidTokenMessage || 'Invalid or expired token';
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ [key]: noTokenMsg });
      return;
    }
    const token = header.split(' ')[1];
    try {
      const user = decodeToken(token, config);
      req.user = { ...user, token };
      next();
    } catch {
      res.status(401).json({ [key]: invalidTokenMsg });
    }
  };
}
