import { Response, NextFunction } from 'express';
import { AuthRequest } from './types';

export function requireRole(roles: string | string[], ...moreRoles: string[]) {
  const roleList = Array.isArray(roles) ? roles : [roles, ...moreRoles];
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role || '';
    if (!roleList.includes(role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
