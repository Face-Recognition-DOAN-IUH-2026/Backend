import { Response, NextFunction } from 'express';
import { AuthRequest, InternalAuthConfig } from './types';

function logInternalAccess(serviceName: string, endpoint: string, key: string, success: boolean) {
  const fingerprint = key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : 'none';
  const timestamp = new Date().toISOString();
  const status = success ? 'SUCCESS' : 'FAILED';
  console.log(`[InternalAudit] ${timestamp} ${serviceName} ${endpoint} key=${fingerprint} status=${status}`);
}

export function createInternalAuth(config: InternalAuthConfig) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-internal-api-key'] as string;
    if (!apiKey || apiKey !== config.internalApiKey) {
      logInternalAccess(config.serviceName, req.path, apiKey || '', false);
      res.status(403).json({ error: 'Invalid or missing internal API key' });
      return;
    }
    logInternalAccess(config.serviceName, req.path, apiKey, true);
    next();
  };
}
