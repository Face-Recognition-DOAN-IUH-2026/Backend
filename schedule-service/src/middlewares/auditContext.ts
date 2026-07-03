import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';

interface AuditContext {
  ipAddress: string | undefined;
  userAgent: string | undefined;
  requestPath: string | undefined;
}

const storage = new AsyncLocalStorage<AuditContext>();

export function auditContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  const ctx: AuditContext = {
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.get('user-agent'),
    requestPath: req.path,
  };
  storage.run(ctx, () => next());
}

export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}
