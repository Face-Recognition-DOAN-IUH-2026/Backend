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

/**
 * @swagger
 * /ai/command-center/summary:
 *   get:
 *     summary: Get AI command center summary (cached)
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved AI summary
 */
router.get('/command-center/summary', asyncHandler(async (req, res) => {
  res.json(await aiService.getSummary(req.user!.token, false));
}));

/**
 * @swagger
 * /ai/command-center/refresh:
 *   post:
 *     summary: Force refresh AI command center summary
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully refreshed AI summary
 */
router.post('/command-center/refresh', asyncHandler(async (req, res) => {
  res.json(await aiService.getSummary(req.user!.token, true));
}));

/**
 * @swagger
 * /ai/insights:
 *   get:
 *     summary: List AI insights with optional filters
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by insight status
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by insight category
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *         description: Filter by insight severity
 *     responses:
 *       200:
 *         description: Successfully retrieved insights list
 */
router.get('/insights', asyncHandler(async (req, res) => {
  res.json(await aiService.listInsights({
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
  }));
}));

/**
 * @swagger
 * /ai/insights/{id}/dismiss:
 *   post:
 *     summary: Dismiss an AI insight
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Insight UUID
 *     responses:
 *       200:
 *         description: Successfully dismissed insight
 */
router.post('/insights/:id/dismiss', asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  res.json(await aiService.dismissInsight(id));
}));

/**
 * @swagger
 * /ai/insights/{id}/explain:
 *   get:
 *     summary: Get AI explanation for an insight
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Insight UUID
 *     responses:
 *       200:
 *         description: Successfully retrieved insight explanation
 */
router.get('/insights/:id/explain', asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  res.json(await aiService.explainInsight(id));
}));

/**
 * @swagger
 * /ai/command-center/chat:
 *   post:
 *     summary: Send a chat message to the AI command center
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Chat message payload
 *     responses:
 *       200:
 *         description: Successfully received AI chat response
 */
router.post('/command-center/chat', asyncHandler(async (req, res) => {
  res.json(await aiService.chat(req.user!.token, req.body));
}));

/**
 * @swagger
 * /ai/recommendations/patron/{studentCode}:
 *   get:
 *     summary: Get AI book recommendations for a patron
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Patron student code
 *     responses:
 *       200:
 *         description: Successfully retrieved book recommendations
 */
router.get('/recommendations/patron/:studentCode', asyncHandler(async (req, res) => {
  res.json(await aiService.recommendBooks(req.user!.token, req.params.studentCode));
}));

export default router;
