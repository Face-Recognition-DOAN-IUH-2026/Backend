import { Router } from 'express';
import { z } from 'zod';
import { createInternalAuth } from '../../../shared/auth';
import { config } from '../config';
import { notificationService } from '../services/NotificationService';
import { notificationHub } from '../realtime/NotificationHub';
import { EmailService } from '../services/EmailService';

const internalAuth = createInternalAuth({
  serviceName: 'notification-service',
  jwtSecret: config.serviceJwtSecret,
});

const router = Router();
router.use(internalAuth);

const emailService = new EmailService();

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

const sendPasswordResetSchema = z.object({
  toEmail: z.string().email(),
  code: z.string().length(6),
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

router.post('/send-password-reset', async (req, res, next) => {
  try {
    const { toEmail, code } = sendPasswordResetSchema.parse(req.body);
    await emailService.sendPasswordResetCode(toEmail, code);
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    next(error);
  }
});

router.post('/send-email-verification', async (req, res, next) => {
  try {
    const { toEmail, code } = z.object({
      toEmail: z.string().email(),
      code: z.string().length(6),
    }).parse(req.body);
    await emailService.sendEmailVerificationCode(toEmail, code);
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    next(error);
  }
});

router.post('/send-overdue-email', async (req, res, next) => {
  try {
    const { toEmail, bookTitle, daysOverdue } = z.object({
      toEmail: z.string().email(),
      bookTitle: z.string().min(1),
      daysOverdue: z.number().int().positive(),
    }).parse(req.body);
    await emailService.sendOverdueEmail(toEmail, bookTitle, daysOverdue);
    res.json({ success: true, message: 'Overdue email sent successfully' });
  } catch (error) {
    next(error);
  }
});

router.post('/send-fine-email', async (req, res, next) => {
  try {
    const { toEmail, bookTitle, fineAmount, daysOverdue } = z.object({
      toEmail: z.string().email(),
      bookTitle: z.string().min(1),
      fineAmount: z.number().positive(),
      daysOverdue: z.number().int().positive(),
    }).parse(req.body);
    await emailService.sendFineEmail(toEmail, bookTitle, fineAmount, daysOverdue);
    res.json({ success: true, message: 'Fine email sent successfully' });
  } catch (error) {
    next(error);
  }
});

router.post('/send-membership-expiry-email', async (req, res, next) => {
  try {
    const { toEmail, expiryDate } = z.object({
      toEmail: z.string().email(),
      expiryDate: z.string().datetime(),
    }).parse(req.body);
    await emailService.sendMembershipExpiryEmail(toEmail, new Date(expiryDate));
    res.json({ success: true, message: 'Membership expiry email sent successfully' });
  } catch (error) {
    next(error);
  }
});

router.post('/send-email-change', async (req, res, next) => {
  try {
    const { toEmail, code } = z.object({
      toEmail: z.string().email(),
      code: z.string().length(6),
    }).parse(req.body);
    await emailService.sendEmailChangeCode(toEmail, code);
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
