import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from '../errors';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, detail: err.message });
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'Kích thước ảnh tối đa 5MB' });
      return;
    }
    res.status(400).json({ error: 'Lỗi upload file' });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', detail: 'Internal server error' });
}
