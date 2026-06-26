import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

function logInternalAccess(serviceName: string, endpoint: string, key: string, success: boolean) {
  const fingerprint = key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : 'none';
  const timestamp = new Date().toISOString();
  const status = success ? 'SUCCESS' : 'FAILED';
  console.log(`[InternalAudit] ${timestamp} ${serviceName} ${endpoint} key=${fingerprint} status=${status}`);
}

export function internalAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-internal-api-key'] as string;
  if (!key || key !== config.internalApiKey) {
    logInternalAccess('automation-service', req.path, key || '', false);
    res.status(403).json({ error: 'Invalid internal API key' });
    return;
  }
  logInternalAccess('automation-service', req.path, key, true);
  next();
}
