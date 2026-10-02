import { createAuth, requireDynamicPermission } from '../../shared/auth';
import type { AuthRequest } from '../../shared/auth/types';
import { config } from '../config';

export { AuthRequest, requireDynamicPermission };

export const auth = createAuth({
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
  errorKey: 'detail',
  noTokenMessage: 'Invalid or expired token',
  invalidTokenMessage: 'Invalid or expired token',
});

export function requireRole(roles: string[], detail: string) {
  return (req: AuthRequest, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ detail });
      return;
    }
    next();
  };
}
