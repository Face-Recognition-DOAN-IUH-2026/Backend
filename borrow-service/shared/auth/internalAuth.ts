import { Response, NextFunction } from 'express';
import { AuthRequest, InternalAuthConfig } from './types';
import { verifyServiceToken } from './serviceToken';

function logInternalAccess(serviceName: string, endpoint: string, identity: string, success: boolean) {
  const fingerprint = identity ? `${identity.substring(0, 4)}...${identity.substring(identity.length - 4)}` : 'none';
  const timestamp = new Date().toISOString();
  const status = success ? 'SUCCESS' : 'FAILED';
  console.log(`[InternalAudit] ${timestamp} ${serviceName} ${endpoint} identity=${fingerprint} status=${status}`);
}

export function createInternalAuth(config: InternalAuthConfig) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const serviceToken = verifyServiceToken(token, config.jwtSecret);
        req.service = serviceToken;
        logInternalAccess(config.serviceName, req.path, `jwt:${serviceToken.sub}`, true);
        next();
        return;
      } catch {
        logInternalAccess(config.serviceName, req.path, 'jwt-invalid', false);
        res.status(403).json({ error: 'Invalid service token' });
        return;
      }
    }

    logInternalAccess(config.serviceName, req.path, 'no-token', false);
    res.status(403).json({ error: 'Missing Authorization header' });
  };
}
