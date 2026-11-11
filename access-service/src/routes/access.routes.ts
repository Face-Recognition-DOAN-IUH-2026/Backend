import { Router } from 'express';
import { z, ZodError } from 'zod';
import { accessService } from '../services/AccessService';
import { createAuth, requireRole } from '../../../shared/auth';
import { config } from '../config';

const auth = createAuth({
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
});
import { realtimeHub } from '../realtime/RealtimeHub';
import type { AuthRequest } from '../../../shared/auth/types';
import type { Response, NextFunction } from 'express';

if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_API_KEY) {
  throw new Error('INTERNAL_API_KEY must be set in production');
}

const staffRoleCheck = requireRole(['admin', 'staff']);

// Device/service-facing guard: X-Internal-Key OR admin/staff JWT (cookie or header).
function requireInternalKeyOrStaff(req: AuthRequest, res: Response, next: NextFunction) {
  const expected = process.env.INTERNAL_API_KEY;
  const provided = req.headers['x-internal-key'];
  if (expected && typeof provided === 'string' && provided === expected) {
    return next();
  }
  auth(req, res, () => {
    staffRoleCheck(req, res, next);
  });
}

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
router.get('/events', requireInternalKeyOrStaff, (_req, res) => {
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
router.get('/recent', requireInternalKeyOrStaff, async (req, res, next) => {
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
      dateFrom: (req.query.date_from ?? req.query.dateFrom) as string | undefined,
      dateTo: (req.query.date_to ?? req.query.dateTo) as string | undefined,
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
    res.json(await accessService.getFrequency({
      days: Number(req.query.days || 7),
      dateFrom: (req.query.date_from ?? req.query.dateFrom) as string | undefined,
      dateTo: (req.query.date_to ?? req.query.dateTo) as string | undefined,
    }));
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

router.get('/stats/recognition', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 30;
    res.json(await accessService.getRecognitionStats(days));
  } catch (error) {
    next(error);
  }
});

router.get('/stats/hourly', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    const date = req.query.date as string | undefined;
    res.json(await accessService.getHourlyStats(date));
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
/**
 * @swagger
 * /access/kiosk/presence:
 *   post:
 *     summary: Mark patron as present via Kiosk interaction
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
 *               - student_code
 *               - device_id
 *             properties:
 *               patron_id:
 *                 type: string
 *               student_code:
 *                 type: string
 *               device_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Presence recorded
 *       400:
 *         description: Missing required fields
 *       403:
 *         description: Unknown kiosk device
 */
router.post('/kiosk/presence', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    const body = z.object({
      patron_id: z.string().min(1, 'patron_id là bắt buộc'),
      student_code: z.string().min(1, 'student_code là bắt buộc'),
      device_id: z.string().min(1, 'device_id là bắt buộc'),
    }).parse(req.body || {});

    const device = await accessService.findKioskDevice(body.device_id);
    if (!device) {
      res.status(403).json({ error: 'Thiết bị Kiosk không hợp lệ' });
      return;
    }

    const result = await accessService.recordKioskPresence(body.patron_id, body.student_code, body.device_id);
    res.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ error: error.errors.map(e => e.message).join(', ') });
      return;
    }
    console.error('[kiosk/presence] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /access/kiosk/approval-request:
 *   post:
 *     summary: Create a kiosk approval request (when face recognition fails)
 *     tags: [Access]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - device_id
 *               - patron_id
 *               - student_code
 *             properties:
 *               device_id:
 *                 type: string
 *               patron_id:
 *                 type: string
 *               student_code:
 *                 type: string
 *               fail_image_url:
 *                 type: string
 *               isbns:
 *                 type: string
 *     responses:
 *       201:
 *         description: Approval request created
 *       400:
 *         description: Validation error
 *       403:
 *         description: Unknown kiosk device
 */
router.post('/kiosk/approval-request', async (req, res, next) => {
  try {
    const body = z.object({
      device_id: z.string().min(1),
      patron_id: z.string().min(1),
      student_code: z.string().min(1),
      fail_image_url: z.string().optional(),
      isbns: z.string().optional(),
    }).parse(req.body || {});

    const device = await accessService.findKioskDevice(body.device_id);
    if (!device) {
      res.status(403).json({ error: 'Thiết bị Kiosk không hợp lệ' });
      return;
    }

    const result = await accessService.createApprovalRequest({
      kioskDeviceId: body.device_id,
      patronId: body.patron_id,
      patronStudentCode: body.student_code,
      failImageUrl: body.fail_image_url || null,
      isbns: body.isbns || null,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ error: error.errors.map(e => e.message).join(', ') });
      return;
    }
    next(error);
  }
});

/**
 * @swagger
 * /access/kiosk/approval-requests/pending:
 *   get:
 *     summary: Get pending approval requests for staff dashboard
 *     tags: [Access]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending requests
 */
router.get('/kiosk/approval-requests/pending', auth, requireRole(['admin', 'staff']), async (_req, res, next) => {
  try {
    res.json(await accessService.getPendingApprovalRequests());
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /access/kiosk/approval-requests/{code}:
 *   get:
 *     summary: Get approval request status (polled by kiosk)
 *     tags: [Access]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Approval request status
 *       404:
 *         description: Not found
 */
router.get('/kiosk/approval-requests/:code', async (req, res, next) => {
  try {
    const result = await accessService.getApprovalRequest(req.params.code);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /access/kiosk/approval-requests/{code}/approve:
 *   post:
 *     summary: Approve a kiosk approval request
 *     tags: [Access]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - approved_by
 *             properties:
 *               approved_by:
 *                 type: string
 *     responses:
 *       200:
 *         description: Request approved
 */
router.post('/kiosk/approval-requests/:code/approve', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    const body = z.object({ approved_by: z.string().min(1) }).parse(req.body || {});
    const result = await accessService.approveRequest(req.params.code, body.approved_by);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /access/kiosk/approval-requests/{code}/reject:
 *   post:
 *     summary: Reject a kiosk approval request
 *     tags: [Access]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - approved_by
 *             properties:
 *               approved_by:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Request rejected
 */
router.post('/kiosk/approval-requests/:code/reject', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    const body = z.object({ approved_by: z.string().min(1), reason: z.string().optional() }).parse(req.body || {});
    const result = await accessService.rejectRequest(req.params.code, body.approved_by, body.reason);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

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

router.post('/patrons/:id/confirm-entry', requireInternalKeyOrStaff, async (req, res, next) => {
  try {
    const result = await accessService.confirmEntry(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/patrons/:id/revert-pending', requireInternalKeyOrStaff, async (req, res, next) => {
  try {
    const result = await accessService.revertPending(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
