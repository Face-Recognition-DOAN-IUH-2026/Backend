import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function internalAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-internal-api-key'];
  if (!apiKey || apiKey !== config.internalApiKey) {
    res.status(403).json({ detail: 'Invalid or missing internal API key' });
    return;
  }
  next();
}
