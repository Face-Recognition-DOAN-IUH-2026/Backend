import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function internalAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-internal-api-key'];
  if (!key || key !== config.internalApiKey) {
    res.status(403).json({ error: 'Invalid internal API key' });
    return;
  }
  next();
}
