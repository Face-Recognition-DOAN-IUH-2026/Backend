import { Router } from 'express';
import { createAuth } from '../../../shared/auth';
import type { AuthRequest } from '../../../shared/auth/types';
import { config } from '../config';
import { notificationService } from '../services/NotificationService';
import { deviceTokenService } from '../services/DeviceTokenService';
import { notificationHub } from '../realtime/NotificationHub';

const auth = createAuth({
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
});

const router = Router();
router.use(auth);

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: List notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unread
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: Filter unread notifications only
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of items to skip
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of items to return
 *     responses:
 *       200:
 *         description: Paginated list of notifications
 */
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const unreadOnly = req.query.unread === 'true';
    const skip = parseInt(req.query.skip as string) || 0;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = await notificationService.list(userId, { unreadOnly, skip, limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Get unread notification count
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 */
router.get('/unread-count', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const count = await notificationService.getUnreadCount(userId);
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /notifications/{id}/read:
 *   put:
 *     summary: Mark a notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Notification ID
 *     responses:
 *       200:
 *         description: Updated notification
 *       404:
 *         description: Notification not found
 */
router.put('/:id/read', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const result = await notificationService.markAsRead(req.params.id, userId);
    if (!result) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /notifications/read-all:
 *   put:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 updated:
 *                   type: integer
 */
router.put('/read-all', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const count = await notificationService.markAllAsRead(userId);
    res.json({ updated: count });
  } catch (error) {
    next(error);
  }
});

router.post('/device-tokens', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { token, platform } = req.body;
    if (!token || !platform) {
      res.status(400).json({ error: 'token and platform are required' });
      return;
    }
    if (!['ios', 'android', 'web'].includes(platform)) {
      res.status(400).json({ error: 'platform must be ios, android, or web' });
      return;
    }
    const result = await deviceTokenService.register(userId, token, platform);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete('/device-tokens', async (req: AuthRequest, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: 'token is required' });
      return;
    }
    await deviceTokenService.unregister(token);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /notifications/events:
 *   get:
 *     summary: SSE stream for real-time notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Server-Sent Events stream
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 */
router.get('/events', (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    notificationHub.addSseClient(userId, res);
  } catch (err) {
    next(err);
  }
});

export default router;
