import { Router } from 'express';
import { z } from 'zod';
import { auth, requireRole, AuthRequest } from '../middlewares/auth';
import { ConfigService } from '../services/ConfigService';
import { HttpError } from '../../../shared/error-handler';

const router = Router();
const configService = new ConfigService();

const VALID_CATEGORIES = ['borrow', 'fine', 'smtp', 'automation', 'access'];

const updateCategorySchema = z.object({
  values: z.record(z.unknown()),
}).refine((data) => Object.keys(data.values).length > 0, {
  message: 'values must not be empty',
});

const testEmailSchema = z.object({
  to: z.string().email('Email nhận test không hợp lệ'),
  host: z.string().min(1, 'SMTP host là bắt buộc'),
  port: z.number().int().min(1).max(65535, 'Port không hợp lệ'),
  secure: z.boolean(),
  user: z.string().min(1, 'SMTP user là bắt buộc'),
  pass: z.string().min(1, 'SMTP password là bắt buộc'),
  from: z.string().min(1, 'Địa chỉ gửi là bắt buộc'),
});

router.use(auth);

router.get('/settings', requireRole(['admin']), async (_req, res, next) => {
  try {
    const settings = await configService.getAll();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.get('/settings/:category', requireRole(['admin']), async (req, res, next) => {
  try {
    if (!VALID_CATEGORIES.includes(req.params.category)) {
      throw new HttpError(400, `Danh mục không hợp lệ. Hỗ trợ: ${VALID_CATEGORIES.join(', ')}`);
    }
    const settings = await configService.getByCategory(req.params.category);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.put('/settings/:category', requireRole(['admin']), async (req, res, next) => {
  try {
    if (!VALID_CATEGORIES.includes(req.params.category)) {
      throw new HttpError(400, `Danh mục không hợp lệ. Hỗ trợ: ${VALID_CATEGORIES.join(', ')}`);
    }
    const { values } = updateCategorySchema.parse(req.body);
    const updated = await configService.updateCategory(req.params.category, values, (req as AuthRequest).user?.id || null);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/settings/test-email', requireRole(['admin']), async (req, res, next) => {
  try {
    const validated = testEmailSchema.parse(req.body);
    const result = await configService.testEmail(validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
