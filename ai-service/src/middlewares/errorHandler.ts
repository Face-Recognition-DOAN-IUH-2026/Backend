import { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const statusCode = err instanceof HttpError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : 'Unexpected error';
  if (statusCode >= 500) console.error('ai-service error:', message);
  res.status(statusCode).json({ error: message });
}
