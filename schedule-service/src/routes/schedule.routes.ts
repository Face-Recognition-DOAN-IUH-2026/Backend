import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { scheduleService } from '../services/ScheduleService';
import { createAuth, requireRole, requireDynamicPermission } from '../../../shared/auth';
import type { AuthRequest } from '../../../shared/auth/types';
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
const preferenceSchema = z.object({
  staffId: z.string().uuid().optional(),
  shiftId: z.string().uuid(),
  zoneId: z.string().uuid(),
  priority: z.number().int().min(1).max(10).optional(),
});
const latLngSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
}).partial();
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
router.get('/staff-options', requireDynamicPermission('schedules', 'read'), asyncHandler(async (req, res) => {
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
router.get('/zones', requireDynamicPermission('schedules', 'read'), asyncHandler(async (_req, res) => {
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
router.post('/zones', requireDynamicPermission('schedules', 'create'), asyncHandler(async (req, res) => {
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
router.put('/zones/:id', requireDynamicPermission('schedules', 'update'), asyncHandler(async (req, res) => {
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
router.delete('/zones/:id', requireDynamicPermission('schedules', 'delete'), asyncHandler(async (req, res) => {
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
router.get('/shifts', requireDynamicPermission('schedules', 'read'), asyncHandler(async (_req, res) => {
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
router.post('/shifts', requireDynamicPermission('schedules', 'create'), asyncHandler(async (req, res) => {
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
router.put('/shifts/:id', requireDynamicPermission('schedules', 'update'), asyncHandler(async (req, res) => {
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
router.delete('/shifts/:id', requireDynamicPermission('schedules', 'delete'), asyncHandler(async (req, res) => {
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
router.get('/templates', requireDynamicPermission('schedules', 'read'), asyncHandler(async (_req, res) => {
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
router.post('/templates', requireDynamicPermission('schedules', 'create'), asyncHandler(async (req, res) => {
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
router.put('/templates/:id', requireDynamicPermission('schedules', 'update'), asyncHandler(async (req, res) => {
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
router.delete('/templates/:id', requireDynamicPermission('schedules', 'delete'), asyncHandler(async (req, res) => {
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
router.get('/preferences', requireDynamicPermission('schedules', 'read'), asyncHandler(async (req, res) => {
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
  const parsed = preferenceSchema.parse(req.body);
  const body = {
    staffId: isAdmin ? (parsed.staffId || req.user!.userId) : req.user!.userId,
    shiftId: parsed.shiftId,
    zoneId: parsed.zoneId,
    priority: parsed.priority,
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
  const isAdmin = req.user!.role === 'admin';
  if (!isAdmin) {
    const pref = await scheduleService.getPreferenceById(id);
    if (!pref) {
      res.status(404).json({ error: 'Preference not found' });
      return;
    }
    if (pref.staffId !== req.user!.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  }
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
router.post('/generate-from-template', requireDynamicPermission('schedules', 'create'), asyncHandler(async (req, res) => {
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
router.get('/assignments', requireDynamicPermission('schedules', 'read'), asyncHandler(async (req, res) => {
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
router.post('/assignments', requireDynamicPermission('schedules', 'create'), asyncHandler(async (req, res) => {
  const force = req.query.force === 'true';
  res.status(201).json(await scheduleService.createAssignment(req.user!.userId, assignmentSchema.parse(req.body), force));
}));
router.post('/assignments/bulk', requireDynamicPermission('schedules', 'create'), asyncHandler(async (req, res) => {
  const force = req.query.force === 'true';
  res.status(201).json(await scheduleService.createAssignmentsBulk(req.user!.userId, z.array(assignmentSchema).parse(req.body), force));
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
router.delete('/assignments/week', requireDynamicPermission('schedules', 'delete'), asyncHandler(async (req, res) => {
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
router.put('/assignments/:id', requireDynamicPermission('schedules', 'update'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const force = req.query.force === 'true';
  res.json(await scheduleService.updateAssignment(req.user!.userId, id, assignmentPatchSchema.parse(req.body), force));
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
router.post('/assignments/:id/move', requireDynamicPermission('schedules', 'update'), asyncHandler(async (req, res) => {
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
router.delete('/assignments/:id', requireDynamicPermission('schedules', 'delete'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deleteAssignment(req.user!.userId, id));
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
 *               wifiSsid:
 *                 type: string
 *     responses:
 *       200:
 *         description: Checked in
 */
router.post('/assignments/:id/check-in', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { lat, lng, wifiSsid } = latLngSchema.extend({ wifiSsid: z.string().optional() }).parse({
    lat: req.body?.lat,
    lng: req.body?.lng,
    wifiSsid: req.body?.wifiSsid,
  });
  res.json(await scheduleService.checkIn(req.user!.userId, id, req.body?.method || 'web', lat, lng, wifiSsid));
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
router.post('/auto-schedule', requireDynamicPermission('schedules', 'create'), asyncHandler(async (req, res) => {
  const { from, to } = rangeSchema.parse(req.body);
  if (from > to) {
    res.status(400).json({ error: 'Ngay bat dau phai nho hon hoac bang ngay ket thuc' });
    return;
  }
  res.json(await scheduleService.autoSchedule(req.user!.userId, from, to));
}));

const geofenceSchema = z.object({
  zoneId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(10).max(10000).optional(),
  addressHint: z.string().nullable().optional(),
  allowedWifiSsids: z.array(z.string()).nullable().optional(),
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
router.get('/geofence', requireDynamicPermission('schedules', 'read'), asyncHandler(async (_req, res) => {
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
 *               allowedWifiSsids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Geofence set
 */
router.put('/geofence', requireDynamicPermission('schedules', 'update'), asyncHandler(async (req, res) => {
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
router.delete('/geofence/:zoneId', requireDynamicPermission('schedules', 'delete'), asyncHandler(async (req, res) => {
  const { zoneId } = z.object({ zoneId: z.string().uuid() }).parse(req.params);
  res.json(await scheduleService.deleteGeofence(req.user!.userId, zoneId));
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
router.post('/assignments/:id/admin-confirm', requireDynamicPermission('schedules', 'approve'), asyncHandler(async (req, res) => {
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
router.put('/assignments/:id/attendance', requireDynamicPermission('schedules', 'update'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.adminFixAttendance(req.user!.userId, id, adminAttendanceSchema.parse(req.body)));
}));

const manualCheckInSchema = z.object({
  assignmentId: z.string().uuid(),
  note: z.string().min(1),
});

router.post('/attendance/manual-checkin', auth, asyncHandler(async (req, res) => {
  const { assignmentId, note } = manualCheckInSchema.parse(req.body);
  res.status(201).json(await scheduleService.requestManualCheckIn(assignmentId, req.user!.userId, note));
}));

router.put('/attendance/:id/approve-manual', requireDynamicPermission('schedules', 'approve'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const checkInAt = req.body?.checkInAt ? new Date(req.body.checkInAt) : undefined;
  res.json(await scheduleService.approveManualCheckIn(req.user!.userId, id, checkInAt));
}));

router.put('/attendance/:id/reject-manual', requireDynamicPermission('schedules', 'approve'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
  res.json(await scheduleService.rejectManualCheckIn(req.user!.userId, id, reason));
}));

router.get('/attendance/manual-checkin-requests', requireDynamicPermission('schedules', 'read'), asyncHandler(async (req, res) => {
  const status = req.query.status as string | undefined;
  res.json(await scheduleService.listManualCheckInRequests(status));
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
router.get('/audit-logs', requireDynamicPermission('schedules', 'read'), asyncHandler(async (req, res) => {
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

router.get('/audit-logs/stats', requireDynamicPermission('schedules', 'read'), asyncHandler(async (req, res) => {
  res.json(await scheduleService.auditStats({
    fromDate: req.query.fromDate as string | undefined,
    toDate: req.query.toDate as string | undefined,
  }));
}));

export default router;
