import { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const statusCode = err instanceof HttpError ? err.statusCode : 500;
  const detail = err instanceof Error ? err.message : 'Internal server error';
  if (statusCode >= 500) {
    console.error('borrow-service error:', detail);
  }
  res.status(statusCode).json({ detail });
}
