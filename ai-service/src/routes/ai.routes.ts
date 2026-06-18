import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auth, AuthRequest } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { aiService } from '../services/AiService';

const router = Router();

const asyncHandler = (
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>,
) => (req: AuthRequest, res: Response, next: NextFunction) => {
  fn(req, res, next).catch(next);
};

router.use(auth, requireRole(['admin', 'staff']));

router.get('/command-center/summary', asyncHandler(async (req, res) => {
  res.json(await aiService.getSummary(req.user!.token, false));
}));

router.post('/command-center/refresh', asyncHandler(async (req, res) => {
  res.json(await aiService.getSummary(req.user!.token, true));
}));

router.get('/insights', asyncHandler(async (req, res) => {
  res.json(await aiService.listInsights({
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
  }));
}));

router.post('/insights/:id/dismiss', asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  res.json(await aiService.dismissInsight(id));
}));

router.get('/insights/:id/explain', asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  res.json(await aiService.explainInsight(id));
}));

router.post('/chat', asyncHandler(async (req, res) => {
  res.json(await aiService.chat(req.user!.token, req.body));
}));

router.get('/recommendations/patron/:studentCode', asyncHandler(async (req, res) => {
  res.json(await aiService.recommendBooks(req.user!.token, req.params.studentCode));
}));

export default router;
