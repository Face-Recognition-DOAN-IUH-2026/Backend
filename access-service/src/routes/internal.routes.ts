import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { createInternalAuth } from '../../shared';
import { config } from '../config';
import { FaceResultEventSchema } from '../contracts';
import { storeFrame, getFrame, deleteFrame, getRedisClient } from '../redis';

const internalAuth = createInternalAuth({
  serviceName: 'access-service',
  jwtSecret: config.serviceJwtSecret,
});
import { accessService } from '../services/AccessService';
import { realtimeHub } from '../realtime/RealtimeHub';

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

router.post('/access/face-results', async (req, res, next) => {
  try {
    const input = FaceResultEventSchema.parse({
      ...req.body,
      event_type: 'face_result',
      event_id: req.body?.event_id || crypto.randomUUID(),
      occurred_at: req.body?.occurred_at || new Date().toISOString(),
    });
    realtimeHub.broadcastFaceResult(input);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/access/face-results-sync', async (req, res, next) => {
  try {
    const body = z.object({
      image: z.string().min(1),
      camera_id: z.string().default('unknown'),
      process_type: z.string().default('face_recognition'),
      result: z.record(z.unknown()).optional(),
      connection_id: z.string().uuid().optional(),
    }).parse(req.body || {});

    if (body.connection_id) {
      const client = getRedisClient();
      const isActive = await client.exists(`sse_connection:${body.connection_id}`);
      if (!isActive) {
        console.warn(`[Security] Invalid or expired connection_id: ${body.connection_id}`);
      }
    }

    const frameId = crypto.randomUUID();
    const imageBuffer = Buffer.from(body.image, 'base64');
    
    await storeFrame(frameId, imageBuffer, 5);

    const result = body.result as Record<string, unknown> | undefined;
    const matches = result?.matches as unknown[] | undefined;
    const hasMatches = Array.isArray(matches) && matches.length > 0;

    const event = FaceResultEventSchema.parse({
      event_id: crypto.randomUUID(),
      event_type: 'face_result',
      task_id: frameId,
      process_type: body.process_type,
      status: hasMatches ? 'SUCCESS' : 'FAILURE',
      result: body.result,
      camera_id: body.camera_id,
      occurred_at: new Date().toISOString(),
      source: 'face-recognition-service',
    });

    realtimeHub.broadcastFaceResult(event);
    
    res.json({ ok: true, frame_id: frameId });
  } catch (error) {
    next(error);
  }
});

router.get('/access/frames/:frameId', async (req, res, next) => {
  try {
    const { frameId } = req.params;
    const frame = await getFrame(frameId);
    
    if (!frame) {
      res.status(404).json({ error: 'Frame not found or expired' });
      return;
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(frame);
  } catch (error) {
    next(error);
  }
});

router.delete('/access/frames/:frameId', async (req, res, next) => {
  try {
    const { frameId } = req.params;
    await deleteFrame(frameId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
