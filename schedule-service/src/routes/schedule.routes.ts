import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { scheduleService } from '../services/ScheduleService';
import { createAuth, AuthRequest, requireRole } from '../../../shared';
import { config } from '../config';

const auth = createAuth({
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
});

const router = Router();
router.use(auth);

const asyncHandler = (
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>,
) => (req: AuthRequest, res: Response, next: NextFunction) => {
  fn(req, res, next).catch(next);
};

const idParam = z.object({ id: z.string().uuid() });
const zoneSchema = z.object({
  floor: z.number().int(),
  zoneName: z.string().min(1),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
const shiftSchema = z.object({
  name: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  minStaff: z.number().int().min(1).optional(),
  maxStaff: z.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});
const templateSchema = z.object({
  name: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  shiftId: z.string().uuid(),
  zoneId: z.string().uuid(),
  staffId: z.string().uuid(),
  isActive: z.boolean().optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const assignmentSchema = z.object({
  staffId: z.string().uuid(),
  shiftId: z.string().uuid(),
  zoneId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().nullable().optional(),
  status: z.string().optional(),
});
const assignmentPatchSchema = assignmentSchema.partial();
const availabilitySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.string().optional(),
  reason: z.string().nullable().optional(),
});
const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * @swagger
 * /schedules/health:
 *   get:
 *     summary: Health check
 *     tags: [Schedule]
 *     responses:
 *       200:
 *         description: Service is healthy
 */
router.get('/health', asyncHandler(async (_req, res) => {
  res.json(await scheduleService.health());
}));

/**
 * @swagger
 * /schedules/staff-options:
 *   get:
 *     summary: List staff options
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: ids
 *         schema:
 *           type: string
 *         description: Comma-separated staff IDs
 *     responses:
 *       200:
 *         description: Staff options retrieved
 */
router.get('/staff-options', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map((id) => id.trim()).filter(Boolean)
    : undefined;
  res.json(await scheduleService.listStaff(ids));
}));

/**
 * @swagger
 * /schedules/zones:
 *   get:
 *     summary: List all zones
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Zones retrieved
 */
router.get('/zones', requireRole('admin', 'staff'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.listZones());
}));
/**
 * @swagger
 * /schedules/zones:
 *   post:
 *     summary: Create a zone
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               floor:
 *                 type: integer
 *               zoneName:
 *                 type: string
 *               description:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Zone created
 */
router.post('/zones', requireRole('admin'), asyncHandler(async (req, res) => {
  const body = zoneSchema.parse(req.body);
  res.status(201).json(await scheduleService.createZone(req.user!.userId, body));
}));
/**
 * @swagger
 * /schedules/zones/{id}:
 *   put:
 *     summary: Update a zone
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               floor:
 *                 type: integer
 *               zoneName:
 *                 type: string
 *               description:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Zone updated
 */
router.put('/zones/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.updateZone(req.user!.userId, id, zoneSchema.partial().parse(req.body)));
}));
/**
 * @swagger
 * /schedules/zones/{id}:
 *   delete:
 *     summary: Delete a zone
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Zone deleted
 */
router.delete('/zones/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deleteZone(req.user!.userId, id));
}));

/**
 * @swagger
 * /schedules/shifts:
 *   get:
 *     summary: List all shifts
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Shifts retrieved
 */
router.get('/shifts', requireRole('admin', 'staff'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.listShifts());
}));
/**
 * @swagger
 * /schedules/shifts:
 *   post:
 *     summary: Create a shift
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               startTime:
 *                 type: string
 *               endTime:
 *                 type: string
 *               minStaff:
 *                 type: integer
 *               isActive:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Shift created
 */
router.post('/shifts', requireRole('admin'), asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createShift(req.user!.userId, shiftSchema.parse(req.body)));
}));
/**
 * @swagger
 * /schedules/shifts/{id}:
 *   put:
 *     summary: Update a shift
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               startTime:
 *                 type: string
 *               endTime:
 *                 type: string
 *               minStaff:
 *                 type: integer
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Shift updated
 */
router.put('/shifts/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.updateShift(req.user!.userId, id, shiftSchema.partial().parse(req.body)));
}));
/**
 * @swagger
 * /schedules/shifts/{id}:
 *   delete:
 *     summary: Delete a shift
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Shift deleted
 */
router.delete('/shifts/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deleteShift(req.user!.userId, id));
}));

/**
 * @swagger
 * /schedules/templates:
 *   get:
 *     summary: List all templates
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Templates retrieved
 */
router.get('/templates', requireRole('admin'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.listTemplates());
}));
/**
 * @swagger
 * /schedules/templates:
 *   post:
 *     summary: Create a template
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               dayOfWeek:
 *                 type: integer
 *               shiftId:
 *                 type: string
 *                 format: uuid
 *               zoneId:
 *                 type: string
 *                 format: uuid
 *               staffId:
 *                 type: string
 *                 format: uuid
 *               isActive:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Template created
 */
router.post('/templates', requireRole('admin'), asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createTemplate(req.user!.userId, templateSchema.parse(req.body)));
}));
/**
 * @swagger
 * /schedules/templates/{id}:
 *   put:
 *     summary: Update a template
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               dayOfWeek:
 *                 type: integer
 *               shiftId:
 *                 type: string
 *                 format: uuid
 *               zoneId:
 *                 type: string
 *                 format: uuid
 *               staffId:
 *                 type: string
 *                 format: uuid
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Template updated
 */
router.put('/templates/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.updateTemplate(req.user!.userId, id, templateSchema.partial().parse(req.body)));
}));
/**
 * @swagger
 * /schedules/templates/{id}:
 *   delete:
 *     summary: Delete a template
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Template deleted
 */
router.delete('/templates/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deleteTemplate(req.user!.userId, id));
}));
/**
 * @swagger
 * /schedules/preferences:
 *   get:
 *     summary: List staff preferences
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: staff_id
 *         schema:
 *           type: string
 *         description: Filter by staff ID
 *     responses:
 *       200:
 *         description: Preferences retrieved
 */
router.get('/preferences', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await scheduleService.listPreferences(
    req.query.staff_id as string | undefined,
    req.query.page ? parseInt(req.query.page as string, 10) : undefined,
    req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
  ));
}));
/**
 * @swagger
 * /schedules/preferences:
 *   post:
 *     summary: Create a staff preference
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               staffId:
 *                 type: string
 *                 format: uuid
 *               shiftId:
 *                 type: string
 *                 format: uuid
 *               zoneId:
 *                 type: string
 *                 format: uuid
 *               priority:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Preference created
 */
router.post('/preferences', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const isAdmin = req.user!.role === 'admin';
  const body = {
    staffId: isAdmin ? (req.body.staffId || req.user!.userId) : req.user!.userId,
    shiftId: req.body.shiftId,
    zoneId: req.body.zoneId,
    priority: req.body.priority,
  };
  res.status(201).json(await scheduleService.createPreference(req.user!.userId, body));
}));
/**
 * @swagger
 * /schedules/preferences/{id}:
 *   delete:
 *     summary: Delete a staff preference
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Preference deleted
 */
router.delete('/preferences/:id', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deletePreference(req.user!.userId, id));
}));
/**
 * @swagger
 * /schedules/generate-from-template:
 *   post:
 *     summary: Generate assignments from templates
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               from:
 *                 type: string
 *                 format: date
 *               to:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Assignments generated
 */
router.post('/generate-from-template', requireRole('admin'), asyncHandler(async (req, res) => {
  const { from, to } = rangeSchema.parse(req.body);
  res.json(await scheduleService.generateFromTemplate(req.user!.userId, from, to));
}));

/**
 * @swagger
 * /schedules/assignments:
 *   get:
 *     summary: List assignments
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: staff_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: zone_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assignments retrieved
 */
router.get('/assignments', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  res.json(await scheduleService.listAssignments({
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    staffId: req.query.staff_id as string | undefined,
    zoneId: req.query.zone_id as string | undefined,
    shiftId: req.query.shift_id as string | undefined,
    status: req.query.status as string | undefined,
    page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
  }));
}));
/**
 * @swagger
 * /schedules/assignments:
 *   post:
 *     summary: Create an assignment
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               staffId:
 *                 type: string
 *                 format: uuid
 *               shiftId:
 *                 type: string
 *                 format: uuid
 *               zoneId:
 *                 type: string
 *                 format: uuid
 *               workDate:
 *                 type: string
 *                 format: date
 *               note:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       201:
 *         description: Assignment created
 */
router.post('/assignments', requireRole('admin'), asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createAssignment(req.user!.userId, assignmentSchema.parse(req.body)));
}));
router.post('/assignments/bulk', requireRole('admin'), asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createAssignmentsBulk(req.user!.userId, z.array(assignmentSchema).parse(req.body)));
}));

/**
 * @swagger
 * /schedules/assignments/week:
 *   delete:
 *     summary: Cancel all future assignments in a date range (bulk delete week)
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from, to]
 *             properties:
 *               from:
 *                 type: string
 *                 format: date
 *               to:
 *                 type: string
 *                 format: date
 *               notify:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Assignments cancelled
 */
router.delete('/assignments/week', requireRole('admin'), asyncHandler(async (req, res) => {
  const { from, to, notify } = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notify: z.boolean().optional().default(false),
  }).parse(req.body);
  res.json(await scheduleService.deleteWeekAssignments(req.user!.userId, from, to, notify));
}));

/**
 * @swagger
 * /schedules/assignments/{id}:
 *   put:
 *     summary: Update an assignment
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               staffId:
 *                 type: string
 *                 format: uuid
 *               shiftId:
 *                 type: string
 *                 format: uuid
 *               zoneId:
 *                 type: string
 *                 format: uuid
 *               workDate:
 *                 type: string
 *                 format: date
 *               note:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Assignment updated
 */
router.put('/assignments/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.updateAssignment(req.user!.userId, id, assignmentPatchSchema.parse(req.body)));
}));
/**
 * @swagger
 * /schedules/assignments/{id}/move:
 *   post:
 *     summary: Move an assignment
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               staffId:
 *                 type: string
 *                 format: uuid
 *               shiftId:
 *                 type: string
 *                 format: uuid
 *               zoneId:
 *                 type: string
 *                 format: uuid
 *               workDate:
 *                 type: string
 *                 format: date
 *               note:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Assignment moved
 */
router.post('/assignments/:id/move', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.moveAssignment(req.user!.userId, id, assignmentPatchSchema.parse(req.body)));
}));
/**
 * @swagger
 * /schedules/assignments/{id}:
 *   delete:
 *     summary: Delete an assignment
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Assignment deleted
 */
router.delete('/assignments/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deleteAssignment(req.user!.userId, id));
}));

/**
 * @swagger
 * /schedules/availability:
 *   get:
 *     summary: List availability records
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: staff_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Availability records retrieved
 */
router.get('/availability', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await scheduleService.listAvailability({
    staffId: req.query.staff_id as string | undefined,
    status: req.query.status as string | undefined,
  }));
}));
/**
 * @swagger
 * /schedules/availability/{id}/approve:
 *   post:
 *     summary: Approve availability request
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Availability approved
 */
router.post('/availability/:id/approve', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.reviewAvailability(req.user!.userId, id, 'approved'));
}));
/**
 * @swagger
 * /schedules/availability/{id}/reject:
 *   post:
 *     summary: Reject availability request
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Availability rejected
 */
router.post('/availability/:id/reject', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.reviewAvailability(req.user!.userId, id, 'rejected'));
}));

/**
 * @swagger
 * /schedules/me:
 *   get:
 *     summary: Get current user schedule
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Current user schedule retrieved
 */
router.get('/me', auth, asyncHandler(async (req, res) => {
  res.json(await scheduleService.listMine(req.user!.userId, req.query.from as string | undefined, req.query.to as string | undefined));
}));
/**
 * @swagger
 * /schedules/me/availability:
 *   get:
 *     summary: Get current user availability
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user availability retrieved
 */
router.get('/me/availability', auth, asyncHandler(async (req, res) => {
  res.json(await scheduleService.listAvailability({ staffId: req.user!.userId }));
}));
/**
 * @swagger
 * /schedules/me/availability:
 *   post:
 *     summary: Create current user availability
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dateFrom:
 *                 type: string
 *                 format: date
 *               dateTo:
 *                 type: string
 *                 format: date
 *               type:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Availability created
 */
router.post('/me/availability', auth, asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createAvailability(req.user!.userId, availabilitySchema.parse(req.body)));
}));

/**
 * @swagger
 * /schedules/open-shifts:
 *   get:
 *     summary: List open shifts
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Open shifts retrieved
 */
router.get('/open-shifts', requireRole('admin', 'staff'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.openShifts());
}));

const bidSchema = z.object({ assignmentId: z.string().uuid(), note: z.string().nullable().optional() });
/**
 * @swagger
 * /schedules/bids:
 *   post:
 *     summary: Create a bid on an open shift
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assignmentId:
 *                 type: string
 *                 format: uuid
 *               note:
 *                 type: string
 *     responses:
 *       201:
 *         description: Bid created
 */
router.post('/bids', auth, asyncHandler(async (req, res) => {
  const { assignmentId, note } = bidSchema.parse(req.body);
  res.status(201).json(await scheduleService.createBid(req.user!.userId, assignmentId, note));
}));
/**
 * @swagger
 * /schedules/bids:
 *   get:
 *     summary: List bids
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: staff_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bids retrieved
 */
router.get('/bids', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const staffId = req.query.staff_id as string | undefined;
  const status = req.query.status as string | undefined;
  res.json(await scheduleService.listBids(staffId, status));
}));
/**
 * @swagger
 * /schedules/bids/{id}/cancel:
 *   post:
 *     summary: Cancel a bid
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Bid cancelled
 */
router.post('/bids/:id/cancel', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.cancelBid(req.user!.userId, id));
}));
/**
 * @swagger
 * /schedules/bids/{id}/approve:
 *   post:
 *     summary: Approve a bid
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Bid approved
 */
router.post('/bids/:id/approve', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.reviewBid(req.user!.userId, id, 'approved'));
}));
/**
 * @swagger
 * /schedules/bids/{id}/reject:
 *   post:
 *     summary: Reject a bid
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Bid rejected
 */
router.post('/bids/:id/reject', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.reviewBid(req.user!.userId, id, 'rejected'));
}));

const swapSchema = z.object({
  targetStaffId: z.string().uuid(),
  requesterAssignmentId: z.string().uuid(),
  targetAssignmentId: z.string().uuid().nullable().optional(),
  reason: z.string().nullable().optional(),
});
/**
 * @swagger
 * /schedules/swaps:
 *   post:
 *     summary: Request a shift swap
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetStaffId:
 *                 type: string
 *                 format: uuid
 *               requesterAssignmentId:
 *                 type: string
 *                 format: uuid
 *               targetAssignmentId:
 *                 type: string
 *                 format: uuid
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Swap request created
 */
router.post('/swaps', auth, asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createSwap(req.user!.userId, swapSchema.parse(req.body)));
}));
/**
 * @swagger
 * /schedules/swaps:
 *   get:
 *     summary: List swap requests for current user
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Swap requests retrieved
 */
router.get('/swaps', auth, asyncHandler(async (req, res) => {
  const staffId = req.user!.userId;
  const status = req.query.status as string | undefined;
  res.json(await scheduleService.listSwaps(staffId, status));
}));
const swapResponseSchema = z.object({ action: z.enum(['accepted', 'rejected']), responseNote: z.string().nullable().optional() });
/**
 * @swagger
 * /schedules/swaps/{id}/respond:
 *   post:
 *     summary: Respond to a swap request
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [accepted, rejected]
 *               responseNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Swap responded
 */
router.post('/swaps/:id/respond', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { action, responseNote } = swapResponseSchema.parse(req.body);
  res.json(await scheduleService.respondSwap(req.user!.userId, id, action, responseNote));
}));

/**
 * @swagger
 * /schedules/assignments/{id}/confirm:
 *   post:
 *     summary: Confirm an assignment
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Assignment confirmed
 */
router.post('/assignments/:id/confirm', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.confirmAssignment(req.user!.userId, id));
}));
/**
 * @swagger
 * /schedules/assignments/{id}/check-in:
 *   post:
 *     summary: Check in to an assignment
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               method:
 *                 type: string
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *     responses:
 *       200:
 *         description: Checked in
 */
router.post('/assignments/:id/check-in', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const lat = req.body?.lat != null ? Number(req.body.lat) : undefined;
  const lng = req.body?.lng != null ? Number(req.body.lng) : undefined;
  res.json(await scheduleService.checkIn(req.user!.userId, id, req.body?.method || 'web', lat, lng));
}));
/**
 * @swagger
 * /schedules/assignments/{id}/check-out:
 *   post:
 *     summary: Check out from an assignment
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Checked out
 */
router.post('/assignments/:id/check-out', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.checkOut(req.user!.userId, id));
}));

/**
 * @swagger
 * /schedules/auto-schedule:
 *   post:
 *     summary: Auto-generate schedule
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               from:
 *                 type: string
 *                 format: date
 *               to:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Schedule generated
 */
router.post('/auto-schedule', requireRole('admin'), asyncHandler(async (req, res) => {
  const { from, to } = rangeSchema.parse(req.body);
  res.json(await scheduleService.autoSchedule(req.user!.userId, from, to));
}));

const geofenceSchema = z.object({
  zoneId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(10).max(10000).optional(),
  addressHint: z.string().nullable().optional(),
});
/**
 * @swagger
 * /schedules/geofence:
 *   get:
 *     summary: List geofence configurations
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Geofence configs retrieved
 */
router.get('/geofence', requireRole('admin'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.listGeofenceConfigs());
}));
/**
 * @swagger
 * /schedules/geofence:
 *   put:
 *     summary: Set geofence for a zone
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               zoneId:
 *                 type: string
 *                 format: uuid
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               radiusMeters:
 *                 type: integer
 *               addressHint:
 *                 type: string
 *     responses:
 *       200:
 *         description: Geofence set
 */
router.put('/geofence', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await scheduleService.setGeofence(req.user!.userId, geofenceSchema.parse(req.body)));
}));
/**
 * @swagger
 * /schedules/geofence/{zoneId}:
 *   delete:
 *     summary: Delete geofence for a zone
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: zoneId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Geofence deleted
 */
router.delete('/geofence/:zoneId', requireRole('admin'), asyncHandler(async (req, res) => {
  const { zoneId } = z.object({ zoneId: z.string().uuid() }).parse(req.params);
  res.json(await scheduleService.deleteGeofence(req.user!.userId, zoneId));
}));

/**
 * @swagger
 * /schedules/swaps/{id}/cancel:
 *   post:
 *     summary: Cancel a swap request (requester only)
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Swap cancelled
 */
router.post('/swaps/:id/cancel', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.cancelSwap(req.user!.userId, id));
}));

/**
 * @swagger
 * /schedules/auto-checkout:
 *   post:
 *     summary: Auto-checkout stale assignments
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Auto-checkout completed
 */
router.post('/auto-checkout', requireRole(['admin']), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.autoCheckoutStaleAssignments());
}));

/**
 * @swagger
 * /schedules/assignments/{id}/admin-confirm:
 *   post:
 *     summary: Admin force-confirm an assignment
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Assignment confirmed
 */
router.post('/assignments/:id/admin-confirm', requireRole(['admin']), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.adminConfirmAssignment(req.user!.userId, id));
}));

const adminAttendanceSchema = z.object({
  checkInAt: z.string().optional(),
  checkOutAt: z.string().optional(),
  status: z.string().optional(),
});
/**
 * @swagger
 * /schedules/assignments/{id}/attendance:
 *   put:
 *     summary: Admin fix attendance for an assignment
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               checkInAt:
 *                 type: string
 *               checkOutAt:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Attendance fixed
 */
router.put('/assignments/:id/attendance', requireRole(['admin']), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.adminFixAttendance(req.user!.userId, id, adminAttendanceSchema.parse(req.body)));
}));

/**
 * @swagger
 * /schedules/audit-logs:
 *   get:
 *     summary: List audit logs
 *     tags: [Schedule]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Audit logs retrieved
 */
router.get('/audit-logs', requireRole(['admin']), asyncHandler(async (req, res) => {
  res.json(await scheduleService.auditLogs({
    page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    category: req.query.category as string | undefined,
    action: req.query.action as string | undefined,
    entityType: req.query.entityType as string | undefined,
    actorId: req.query.actorId as string | undefined,
    fromDate: req.query.fromDate as string | undefined,
    toDate: req.query.toDate as string | undefined,
    search: req.query.search as string | undefined,
  }));
}));

router.get('/audit-logs/stats', requireRole(['admin']), asyncHandler(async (req, res) => {
  res.json(await scheduleService.auditStats({
    fromDate: req.query.fromDate as string | undefined,
    toDate: req.query.toDate as string | undefined,
  }));
}));

export default router;
