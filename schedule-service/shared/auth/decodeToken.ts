import * as jwt from 'jsonwebtoken';
import { AuthConfig, UserPayload } from './types';

export function decodeToken(token: string, config: AuthConfig): UserPayload {
  const decoded: any = jwt.verify(token, config.jwtSecret, {
    audience: config.jwtAudience || undefined,
    issuer: config.jwtIssuer || undefined,
  });
  const userId = decoded.sub;
  return {
    userId,
    id: userId,
    email: decoded.email || '',
    role: decoded.roles?.[0] || decoded.role || 'user',
    fullName: decoded.full_name || decoded.fullName || null,
  };
}
