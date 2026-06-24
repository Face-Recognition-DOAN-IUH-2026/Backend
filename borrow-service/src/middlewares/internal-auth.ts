import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

function logInternalAccess(serviceName: string, endpoint: string, key: string, success: boolean) {
  const fingerprint = key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : 'none';
  const timestamp = new Date().toISOString();
  const status = success ? 'SUCCESS' : 'FAILED';
  console.log(`[InternalAudit] ${timestamp} ${serviceName} ${endpoint} key=${fingerprint} status=${status}`);
}

export function internalAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-internal-api-key'] as string;
  if (!apiKey || apiKey !== config.internalApiKey) {
    logInternalAccess('borrow-service', req.path, apiKey || '', false);
    res.status(403).json({ detail: 'Invalid or missing internal API key' });
    return;
  }
  logInternalAccess('borrow-service', req.path, apiKey, true);
  next();
}
