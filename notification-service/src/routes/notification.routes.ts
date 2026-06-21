import { Router } from 'express';
import { auth, AuthRequest } from '../middlewares/auth';
import { notificationService } from '../services/NotificationService';
import { notificationHub } from '../realtime/NotificationHub';

const router = Router();
router.use(auth);

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

router.get('/unread-count', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const count = await notificationService.getUnreadCount(userId);
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

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

router.put('/read-all', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const count = await notificationService.markAllAsRead(userId);
    res.json({ updated: count });
  } catch (error) {
    next(error);
  }
});

router.get('/events', (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  notificationHub.addSseClient(userId, res);
});

export default router;
