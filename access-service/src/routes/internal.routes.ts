import { Router } from 'express';
import { z } from 'zod';
import { createInternalAuth } from '../../shared';
import { config } from '../config';

const internalAuth = createInternalAuth({
  serviceName: 'access-service',
  jwtSecret: config.serviceJwtSecret,
});
import { accessService } from '../services/AccessService';

const router = Router();
router.use(internalAuth);

router.post('/access/recognition-events', async (req, res, next) => {
  try {
    const event = await accessService.recordRecognitionEvent(req.body || {});
    res.json({ ok: true, event });
  } catch (error) {
    next(error);
  }
});

router.get('/access/patrons/:id/status', async (req, res, next) => {
  try {
    res.json(await accessService.getStatus(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.post('/access/patrons/:id/status', async (req, res, next) => {
  try {
    const body = z.object({
      current_status: z.enum(['inside', 'outside']).optional(),
      currentStatus: z.enum(['inside', 'outside']).optional(),
      camera_id: z.string().optional().nullable(),
      cameraId: z.string().optional().nullable(),
    }).parse(req.body || {});
    const currentStatus = body.current_status || body.currentStatus;
    if (!currentStatus) {
      res.status(400).json({ error: 'current_status is required' });
      return;
    }
    res.json(await accessService.setStatus(req.params.id, currentStatus, body.camera_id || body.cameraId));
  } catch (error) {
    next(error);
  }
});

router.get('/access/stats', async (_req, res, next) => {
  try {
    res.json(await accessService.getStats());
  } catch (error) {
    next(error);
  }
});

router.get('/access/active', async (_req, res, next) => {
  try {
    res.json(await accessService.getActive());
  } catch (error) {
    next(error);
  }
});

router.post('/access/force-exit', async (req, res, next) => {
  try {
    const body = z.object({
      patron_id: z.string(),
    }).parse(req.body || {});
    await accessService.setStatus(body.patron_id, 'outside', 'manual_override');
    res.json({ ok: true, message: 'Đã đánh dấu độc giả đã ra' });
  } catch (error) {
    next(error);
  }
});

export default router;
