import * as jwt from 'jsonwebtoken';
import { Response, NextFunction } from 'express';
import { AuthRequest, ServiceToken, ServiceAuthConfig } from './types';

export function generateServiceToken(
  serviceName: string,
  scopes: string[],
  secret: string,
  expiresInSeconds: number = 900
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: ServiceToken = {
    sub: serviceName,
    scope: scopes,
    iat: now,
    exp: now + expiresInSeconds,
  };
  return jwt.sign(payload, secret);
}

export function verifyServiceToken(token: string, secret: string): ServiceToken {
  const decoded = jwt.verify(token, secret) as ServiceToken;
  return {
    sub: decoded.sub,
    scope: decoded.scope,
    iat: decoded.iat,
    exp: decoded.exp,
  };
}

let cachedToken: string | null = null;
let cachedTokenExpiry: number = 0;

export function getServiceToken(serviceName: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  // Cache token for 5 minutes (refresh before expiry)
  if (cachedToken && cachedTokenExpiry > now + 60) {
    return cachedToken;
  }
  const { getScopesForService } = require('./serviceScopes');
  const scopes = getScopesForService(serviceName);
  cachedToken = generateServiceToken(serviceName, scopes, secret, 900);
  cachedTokenExpiry = now + 900;
  return cachedToken;
}

export function createServiceAuthMiddleware(config: ServiceAuthConfig) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No service token provided' });
      return;
    }

    const token = header.split(' ')[1];
    try {
      const serviceToken = verifyServiceToken(token, config.jwtSecret);

      // Check required scopes
      const missingScopes = config.requiredScopes.filter(
        scope => !serviceToken.scope.includes(scope)
      );
      if (missingScopes.length > 0) {
        res.status(403).json({
          error: 'Insufficient scope',
          missing: missingScopes,
        });
        return;
      }

      req.service = serviceToken;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired service token' });
    }
  };
}
