"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const ScheduleService_1 = require("../services/ScheduleService");
const shared_1 = require("../../../shared");
const config_1 = require("../config");
const auth = (0, shared_1.createAuth)({
    jwtSecret: config_1.config.jwtSecret,
    jwtAudience: config_1.config.jwtAudience,
    jwtIssuer: config_1.config.jwtIssuer,
});
const router = (0, express_1.Router)();
router.use(auth);
const asyncHandler = (fn) => (req, res, next) => {
    fn(req, res, next).catch(next);
};
const idParam = zod_1.z.object({ id: zod_1.z.string().uuid() });
const zoneSchema = zod_1.z.object({
    floor: zod_1.z.number().int(),
    zoneName: zod_1.z.string().min(1),
    description: zod_1.z.string().nullable().optional(),
    isActive: zod_1.z.boolean().optional(),
});
const shiftSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    startTime: zod_1.z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    endTime: zod_1.z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    minStaff: zod_1.z.number().int().min(1).optional(),
    maxStaff: zod_1.z.number().int().min(1).nullable().optional(),
    isActive: zod_1.z.boolean().optional(),
});
const templateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    dayOfWeek: zod_1.z.number().int().min(0).max(6),
    shiftId: zod_1.z.string().uuid(),
    zoneId: zod_1.z.string().uuid(),
    staffId: zod_1.z.string().uuid(),
    isActive: zod_1.z.boolean().optional(),
    validFrom: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    validTo: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const assignmentSchema = zod_1.z.object({
    staffId: zod_1.z.string().uuid(),
    shiftId: zod_1.z.string().uuid(),
    zoneId: zod_1.z.string().uuid(),
    workDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: zod_1.z.string().nullable().optional(),
    status: zod_1.z.string().optional(),
});
const assignmentPatchSchema = assignmentSchema.partial();
const availabilitySchema = zod_1.z.object({
    dateFrom: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: zod_1.z.string().optional(),
    reason: zod_1.z.string().nullable().optional(),
});
const rangeSchema = zod_1.z.object({
    from: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
    res.json(await ScheduleService_1.scheduleService.health());
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
router.get('/staff-options', (0, shared_1.requireRole)('admin', 'staff'), asyncHandler(async (req, res) => {
    const ids = typeof req.query.ids === 'string'
        ? req.query.ids.split(',').map((id) => id.trim()).filter(Boolean)
        : undefined;
    res.json(await ScheduleService_1.scheduleService.listStaff(ids));
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
router.get('/zones', (0, shared_1.requireRole)('admin', 'staff'), asyncHandler(async (_req, res) => {
    res.json(await ScheduleService_1.scheduleService.listZones());
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
router.post('/zones', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const body = zoneSchema.parse(req.body);
    res.status(201).json(await ScheduleService_1.scheduleService.createZone(req.user.userId, body));
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
router.put('/zones/:id', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.updateZone(req.user.userId, id, zoneSchema.partial().parse(req.body)));
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
router.delete('/zones/:id', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.deleteZone(req.user.userId, id));
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
router.get('/shifts', (0, shared_1.requireRole)('admin', 'staff'), asyncHandler(async (_req, res) => {
    res.json(await ScheduleService_1.scheduleService.listShifts());
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
router.post('/shifts', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    res.status(201).json(await ScheduleService_1.scheduleService.createShift(req.user.userId, shiftSchema.parse(req.body)));
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
router.put('/shifts/:id', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.updateShift(req.user.userId, id, shiftSchema.partial().parse(req.body)));
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
router.delete('/shifts/:id', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.deleteShift(req.user.userId, id));
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
router.get('/templates', (0, shared_1.requireRole)('admin'), asyncHandler(async (_req, res) => {
    res.json(await ScheduleService_1.scheduleService.listTemplates());
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
router.post('/templates', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    res.status(201).json(await ScheduleService_1.scheduleService.createTemplate(req.user.userId, templateSchema.parse(req.body)));
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
router.put('/templates/:id', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.updateTemplate(req.user.userId, id, templateSchema.partial().parse(req.body)));
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
router.delete('/templates/:id', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.deleteTemplate(req.user.userId, id));
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
router.get('/preferences', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    res.json(await ScheduleService_1.scheduleService.listPreferences(req.query.staff_id, req.query.page ? parseInt(req.query.page, 10) : undefined, req.query.limit ? parseInt(req.query.limit, 10) : undefined));
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
router.post('/preferences', (0, shared_1.requireRole)('admin', 'staff'), asyncHandler(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const body = {
        staffId: isAdmin ? (req.body.staffId || req.user.userId) : req.user.userId,
        shiftId: req.body.shiftId,
        zoneId: req.body.zoneId,
        priority: req.body.priority,
    };
    res.status(201).json(await ScheduleService_1.scheduleService.createPreference(req.user.userId, body));
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
router.delete('/preferences/:id', (0, shared_1.requireRole)('admin', 'staff'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.deletePreference(req.user.userId, id));
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
router.post('/generate-from-template', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { from, to } = rangeSchema.parse(req.body);
    res.json(await ScheduleService_1.scheduleService.generateFromTemplate(req.user.userId, from, to));
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
router.get('/assignments', (0, shared_1.requireRole)('admin', 'staff'), asyncHandler(async (req, res) => {
    res.json(await ScheduleService_1.scheduleService.listAssignments({
        from: req.query.from,
        to: req.query.to,
        staffId: req.query.staff_id,
        zoneId: req.query.zone_id,
        shiftId: req.query.shift_id,
        status: req.query.status,
        page: req.query.page ? parseInt(req.query.page, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
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
router.post('/assignments', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const force = req.query.force === 'true';
    res.status(201).json(await ScheduleService_1.scheduleService.createAssignment(req.user.userId, assignmentSchema.parse(req.body), force));
}));
router.post('/assignments/bulk', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const force = req.query.force === 'true';
    res.status(201).json(await ScheduleService_1.scheduleService.createAssignmentsBulk(req.user.userId, zod_1.z.array(assignmentSchema).parse(req.body), force));
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
router.delete('/assignments/week', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { from, to, notify } = zod_1.z.object({
        from: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notify: zod_1.z.boolean().optional().default(false),
    }).parse(req.body);
    res.json(await ScheduleService_1.scheduleService.deleteWeekAssignments(req.user.userId, from, to, notify));
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
router.put('/assignments/:id', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const force = req.query.force === 'true';
    res.json(await ScheduleService_1.scheduleService.updateAssignment(req.user.userId, id, assignmentPatchSchema.parse(req.body), force));
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
router.post('/assignments/:id/move', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.moveAssignment(req.user.userId, id, assignmentPatchSchema.parse(req.body)));
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
router.delete('/assignments/:id', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.deleteAssignment(req.user.userId, id));
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
router.get('/availability', (0, shared_1.requireRole)('admin', 'staff'), asyncHandler(async (req, res) => {
    res.json(await ScheduleService_1.scheduleService.listAvailability({
        staffId: req.query.staff_id,
        status: req.query.status,
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
router.post('/availability/:id/approve', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.reviewAvailability(req.user.userId, id, 'approved'));
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
router.post('/availability/:id/reject', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.reviewAvailability(req.user.userId, id, 'rejected'));
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
    res.json(await ScheduleService_1.scheduleService.listMine(req.user.userId, req.query.from, req.query.to));
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
    res.json(await ScheduleService_1.scheduleService.listAvailability({ staffId: req.user.userId }));
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
    res.status(201).json(await ScheduleService_1.scheduleService.createAvailability(req.user.userId, availabilitySchema.parse(req.body)));
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
router.get('/open-shifts', (0, shared_1.requireRole)('admin', 'staff'), asyncHandler(async (_req, res) => {
    res.json(await ScheduleService_1.scheduleService.openShifts());
}));
const bidSchema = zod_1.z.object({ assignmentId: zod_1.z.string().uuid(), note: zod_1.z.string().nullable().optional() });
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
    res.status(201).json(await ScheduleService_1.scheduleService.createBid(req.user.userId, assignmentId, note));
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
router.get('/bids', (0, shared_1.requireRole)('admin', 'staff'), asyncHandler(async (req, res) => {
    const staffId = req.query.staff_id;
    const status = req.query.status;
    res.json(await ScheduleService_1.scheduleService.listBids(staffId, status));
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
    res.json(await ScheduleService_1.scheduleService.cancelBid(req.user.userId, id));
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
router.post('/bids/:id/approve', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.reviewBid(req.user.userId, id, 'approved'));
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
router.post('/bids/:id/reject', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.reviewBid(req.user.userId, id, 'rejected'));
}));
const swapSchema = zod_1.z.object({
    targetStaffId: zod_1.z.string().uuid().nullable().optional(),
    requesterAssignmentId: zod_1.z.string().uuid(),
    targetAssignmentId: zod_1.z.string().uuid().nullable().optional(),
    reason: zod_1.z.string().nullable().optional(),
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
 *                 nullable: true
 *                 description: Target staff UUID, or null/omit for open swap
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
    const parsed = swapSchema.parse(req.body);
    res.status(201).json(await ScheduleService_1.scheduleService.createSwap(req.user.userId, { ...parsed, targetStaffId: parsed.targetStaffId ?? null }));
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
    const staffId = req.user.userId;
    const status = req.query.status;
    res.json(await ScheduleService_1.scheduleService.listSwaps(staffId, status));
}));
const swapResponseSchema = zod_1.z.object({ action: zod_1.z.enum(['accepted', 'rejected']), responseNote: zod_1.z.string().nullable().optional() });
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
    res.json(await ScheduleService_1.scheduleService.respondSwap(req.user.userId, id, action, responseNote));
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
    res.json(await ScheduleService_1.scheduleService.confirmAssignment(req.user.userId, id));
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
    const lat = req.body?.lat != null ? Number(req.body.lat) : undefined;
    const lng = req.body?.lng != null ? Number(req.body.lng) : undefined;
    const wifiSsid = req.body?.wifiSsid;
    res.json(await ScheduleService_1.scheduleService.checkIn(req.user.userId, id, req.body?.method || 'web', lat, lng, wifiSsid));
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
    res.json(await ScheduleService_1.scheduleService.checkOut(req.user.userId, id));
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
router.post('/auto-schedule', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { from, to } = rangeSchema.parse(req.body);
    if (from > to) {
        res.status(400).json({ error: 'Ngay bat dau phai nho hon hoac bang ngay ket thuc' });
        return;
    }
    res.json(await ScheduleService_1.scheduleService.autoSchedule(req.user.userId, from, to));
}));
const geofenceSchema = zod_1.z.object({
    zoneId: zod_1.z.string().uuid(),
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
    radiusMeters: zod_1.z.number().int().min(10).max(10000).optional(),
    addressHint: zod_1.z.string().nullable().optional(),
    allowedWifiSsids: zod_1.z.array(zod_1.z.string()).nullable().optional(),
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
router.get('/geofence', (0, shared_1.requireRole)('admin'), asyncHandler(async (_req, res) => {
    res.json(await ScheduleService_1.scheduleService.listGeofenceConfigs());
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
router.put('/geofence', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    res.json(await ScheduleService_1.scheduleService.setGeofence(req.user.userId, geofenceSchema.parse(req.body)));
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
router.delete('/geofence/:zoneId', (0, shared_1.requireRole)('admin'), asyncHandler(async (req, res) => {
    const { zoneId } = zod_1.z.object({ zoneId: zod_1.z.string().uuid() }).parse(req.params);
    res.json(await ScheduleService_1.scheduleService.deleteGeofence(req.user.userId, zoneId));
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
    res.json(await ScheduleService_1.scheduleService.cancelSwap(req.user.userId, id));
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
router.post('/auto-checkout', (0, shared_1.requireRole)(['admin']), asyncHandler(async (_req, res) => {
    res.json(await ScheduleService_1.scheduleService.autoCheckoutStaleAssignments());
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
router.post('/assignments/:id/admin-confirm', (0, shared_1.requireRole)(['admin']), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.adminConfirmAssignment(req.user.userId, id));
}));
const adminAttendanceSchema = zod_1.z.object({
    checkInAt: zod_1.z.string().optional(),
    checkOutAt: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
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
router.put('/assignments/:id/attendance', (0, shared_1.requireRole)(['admin']), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.adminFixAttendance(req.user.userId, id, adminAttendanceSchema.parse(req.body)));
}));
const manualCheckInSchema = zod_1.z.object({
    assignmentId: zod_1.z.string().uuid(),
    note: zod_1.z.string().min(1),
});
router.post('/attendance/manual-checkin', auth, asyncHandler(async (req, res) => {
    const { assignmentId, note } = manualCheckInSchema.parse(req.body);
    res.status(201).json(await ScheduleService_1.scheduleService.requestManualCheckIn(assignmentId, req.user.userId, note));
}));
router.put('/attendance/:id/approve-manual', (0, shared_1.requireRole)(['admin']), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const checkInAt = req.body?.checkInAt ? new Date(req.body.checkInAt) : undefined;
    res.json(await ScheduleService_1.scheduleService.approveManualCheckIn(req.user.userId, id, checkInAt));
}));
router.put('/attendance/:id/reject-manual', (0, shared_1.requireRole)(['admin']), asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { reason } = zod_1.z.object({ reason: zod_1.z.string().min(1) }).parse(req.body);
    res.json(await ScheduleService_1.scheduleService.rejectManualCheckIn(req.user.userId, id, reason));
}));
router.get('/attendance/manual-checkin-requests', (0, shared_1.requireRole)(['admin']), asyncHandler(async (req, res) => {
    const status = req.query.status;
    res.json(await ScheduleService_1.scheduleService.listManualCheckInRequests(status));
}));
router.post('/swaps/:id/claim', auth, asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await ScheduleService_1.scheduleService.claimOpenSwap(req.user.userId, id));
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
router.get('/audit-logs', (0, shared_1.requireRole)(['admin']), asyncHandler(async (req, res) => {
    res.json(await ScheduleService_1.scheduleService.auditLogs({
        page: req.query.page ? parseInt(req.query.page, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
        category: req.query.category,
        action: req.query.action,
        entityType: req.query.entityType,
        actorId: req.query.actorId,
        fromDate: req.query.fromDate,
        toDate: req.query.toDate,
        search: req.query.search,
    }));
}));
router.get('/audit-logs/stats', (0, shared_1.requireRole)(['admin']), asyncHandler(async (req, res) => {
    res.json(await ScheduleService_1.scheduleService.auditStats({
        fromDate: req.query.fromDate,
        toDate: req.query.toDate,
    }));
}));
exports.default = router;
