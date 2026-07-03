import { Request } from 'express';

export interface UserPayload {
  userId: string;
  id: string;
  email: string;
  role: string;
  fullName?: string | null;
  token?: string;
}

export interface AuthRequest extends Request {
  user?: UserPayload;
  service?: ServiceToken;
}

export interface ServiceToken {
  sub: string;
  scope: string[];
  iat: number;
  exp: number;
}

export interface ServiceAuthConfig {
  serviceName: string;
  jwtSecret: string;
  requiredScopes: string[];
}

export interface InternalAuthConfig {
  serviceName: string;
  jwtSecret: string;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtAudience?: string;
  jwtIssuer?: string;
  errorKey?: 'error' | 'detail';
  userIdField?: 'userId' | 'id';
  noTokenMessage?: string;
  invalidTokenMessage?: string;
}
