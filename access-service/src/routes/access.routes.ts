import { Router } from 'express';
import { z } from 'zod';
import { accessService } from '../services/AccessService';
import { auth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { realtimeHub } from '../realtime/RealtimeHub';

const router = Router();

/**
 * @swagger
 * /access/events:
 *   get:
 *     summary: SSE stream for real-time access events
 *     tags: [Access]
 *     responses:
 *       200:
 *         description: Event stream (text/event-stream)
 */
router.get('/events', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  realtimeHub.addSseClient(res);
});

/**
 * @swagger
 * /access/recent:
 *   get:
 *     summary: Get recent access events
 *     tags: [Access]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of recent access events
 */
router.get('/recent', async (req, res, next) => {
  try {
    res.json(await accessService.getRecent(Number(req.query.limit || 20)));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /access/logs:
 *   get:
 *     summary: Get access logs (filtered)
 *     tags: [Access]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: patron_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 200
 *     responses:
 *       200:
 *         description: List of access logs
 */
router.get('/logs', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    res.json(await accessService.getLogs({
      patronId: req.query.patron_id as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      limit: Number(req.query.limit || 200),
    }));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /access/active:
 *   get:
 *     summary: Get currently active patrons
 *     tags: [Access]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active patrons
 */
router.get('/active', auth, requireRole(['admin', 'staff']), async (_req, res, next) => {
  try {
    res.json(await accessService.getActive());
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /access/frequency:
 *   get:
 *     summary: Get access frequency over time
 *     tags: [Access]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *     responses:
 *       200:
 *         description: Access frequency data
 */
router.get('/frequency', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    res.json(await accessService.getFrequency(Number(req.query.days || 7)));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /access/stats:
 *   get:
 *     summary: Get access statistics
 *     tags: [Access]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Access statistics
 */
router.get('/stats', auth, requireRole(['admin', 'staff']), async (_req, res, next) => {
  try {
    res.json(await accessService.getStats());
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /access/test-broadcast:
 *   post:
 *     summary: Broadcast a manual test recognition event
 *     tags: [Access]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               camera_id:
 *                 type: string
 *                 default: kiosk
 *               status:
 *                 type: string
 *                 default: granted
 *               patron_id:
 *                 type: string
 *               student_code:
 *                 type: string
 *               full_name:
 *                 type: string
 *               access_type:
 *                 type: string
 *                 enum: [entry, exit]
 *               score:
 *                 type: number
 *     responses:
 *       200:
 *         description: Broadcast result
 */
router.post('/test-broadcast', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    const body = z.object({
      camera_id: z.string().default('kiosk'),
      status: z.string().default('granted'),
      patron_id: z.string().optional(),
      student_code: z.string().optional(),
      full_name: z.string().optional(),
      access_type: z.enum(['entry', 'exit']).optional(),
      score: z.number().optional(),
    }).passthrough().parse(req.body || {});
    const event = await accessService.recordRecognitionEvent({ ...body, source: 'manual-test' });
    res.json({ ok: true, event });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /access/force-exit:
 *   post:
 *     summary: Force mark a patron as outside the library
 *     tags: [Access]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - patron_id
 *             properties:
 *               patron_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Patron marked as outside
 */
router.post('/force-exit', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    const body = z.object({
      patron_id: z.string(),
    }).parse(req.body || {});
    await accessService.setStatus(body.patron_id, 'outside', 'manual_override');
    res.json({ ok: true, message: 'Đã đánh dấu độc giả đã ra khỏi thư viện' });
  } catch (error) {
    next(error);
  }
});

export default router;
