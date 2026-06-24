import { Request, Response, NextFunction } from 'express';
import { authService } from '../services';
import { config } from '../config';

function logInternalAccess(serviceName: string, endpoint: string, key: string, success: boolean) {
  const fingerprint = key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : 'none';
  const timestamp = new Date().toISOString();
  const status = success ? 'SUCCESS' : 'FAILED';
  console.log(`[InternalAudit] ${timestamp} ${serviceName} ${endpoint} key=${fingerprint} status=${status}`);
}

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
    fullName?: string | null;
  };
}

export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const internalKey = req.headers['x-internal-api-key'] as string | undefined;
  if (internalKey && internalKey === config.internalApiKey) {
    logInternalAccess('user-service', req.path, internalKey, true);
    req.user = { userId: '', email: '', role: 'admin', fullName: 'internal' };
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const token = authHeader.split(' ')[1];
    const payload = authService.verifyToken(token, 'access');
    req.user = payload;
    next();
  } catch (error: any) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
