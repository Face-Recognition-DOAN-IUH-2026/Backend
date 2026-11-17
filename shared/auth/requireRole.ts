import { Response, NextFunction } from 'express';
import { AuthRequest } from './types';

export function requireRole(roles: string | string[], ...moreRoles: string[]) {
  const roleList = (Array.isArray(roles) ? roles : [roles, ...moreRoles]).map((r) => r.toLowerCase());
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = (req.user?.role || '').toLowerCase();
    const isDirectMatch = roleList.includes(role);
    const isCustomStaffMatch =
      roleList.includes('staff') &&
      Boolean(role) &&
      !['patron', 'user', 'admin'].includes(role);
    if (!isDirectMatch && !isCustomStaffMatch) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
