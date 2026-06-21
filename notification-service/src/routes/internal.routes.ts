import { Router } from 'express';
import { z } from 'zod';
import { internalAuth } from '../middlewares/internalAuth';
import { notificationService } from '../services/NotificationService';
import { notificationHub } from '../realtime/NotificationHub';

const router = Router();
router.use(internalAuth);

const createNotificationSchema = z.object({
  userId: z.string().uuid(),
  type: z.string().min(1).max(50),
  title: z.string().min(1).max(255),
  body: z.string().min(1),
  data: z.record(z.any()).optional(),
});

const createManySchema = z.object({
  notifications: z.array(createNotificationSchema).min(1).max(100),
});

router.post('/', async (req, res, next) => {
  try {
    const input = createNotificationSchema.parse(req.body);
    const notification = await notificationService.create(input);
    await notificationHub.publish(input.userId, notification);
    res.json(notification);
  } catch (error) {
    next(error);
  }
});

router.post('/bulk', async (req, res, next) => {
  try {
    const input = createManySchema.parse(req.body);
    const notifications = await notificationService.createMany(input.notifications);
    // Push each notification to its user
    for (const n of notifications) {
      await notificationHub.publish(n.userId, n);
    }
    res.json({ created: notifications.length, notifications });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const notification = await notificationService.findById(req.params.id);
    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.json(notification);
  } catch (error) {
    next(error);
  }
});

export default router;
