import { createAuth, requireDynamicPermission, requireRole } from '../../shared/auth';
import type { AuthRequest } from '../../shared/auth/types';
import { config } from '../config';

export { AuthRequest, requireDynamicPermission, requireRole };

export const auth = createAuth({
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
  errorKey: 'detail',
  noTokenMessage: 'Invalid or expired token',
  invalidTokenMessage: 'Invalid or expired token',
});
