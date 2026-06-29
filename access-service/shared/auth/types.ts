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
}

export interface ServiceToken {
  sub: string;
  scope: string[];
  iat: number;
  exp: number;
}

export interface InternalAuthConfig {
  serviceName: string;
  internalApiKey: string;
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
