import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const messages = err.errors.map((e) => e.message).join('; ');
    res.status(400).json({ detail: messages });
    return;
  }
  const statusCode = err instanceof HttpError ? err.statusCode : (typeof (err as any)?.statusCode === 'number' ? (err as any).statusCode : 500);
  const detail = err instanceof Error ? err.message : 'Internal server error';
  const code = (err as any)?.code;
  if (statusCode >= 500) {
    console.error('borrow-service error:', detail);
  }
  res.status(statusCode).json({ detail, ...(code ? { code } : {}) });
}
