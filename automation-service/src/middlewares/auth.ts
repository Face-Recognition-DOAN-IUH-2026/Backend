import { Response, NextFunction } from 'express';
import { config } from '../config';
import { AuthRequest, createAuth } from '../../../shared';

export { AuthRequest };

const authConfig = {
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
};

export const auth = createAuth(authConfig);

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
