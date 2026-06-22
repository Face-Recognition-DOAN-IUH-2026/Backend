import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { scheduleService } from '../services/ScheduleService';
import { AuthRequest, auth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';

const router = Router();

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
  isActive: z.boolean().optional(),
});
const templateSchema = z.object({
  name: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  shiftId: z.string().uuid(),
  zoneId: z.string().uuid(),
  staffId: z.string().uuid(),
  isActive: z.boolean().optional(),
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

router.get('/health', asyncHandler(async (_req, res) => {
  res.json(await scheduleService.health());
}));

router.get('/staff-options', requireRole('admin'), asyncHandler(async (req, res) => {
  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map((id) => id.trim()).filter(Boolean)
    : undefined;
  res.json(await scheduleService.listStaff(ids));
}));

router.get('/zones', requireRole('admin', 'staff'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.listZones());
}));
router.post('/zones', requireRole('admin'), asyncHandler(async (req, res) => {
  const body = zoneSchema.parse(req.body);
  res.status(201).json(await scheduleService.createZone(req.user!.userId, body));
}));
router.put('/zones/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.updateZone(req.user!.userId, id, zoneSchema.partial().parse(req.body)));
}));
router.delete('/zones/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deleteZone(req.user!.userId, id));
}));

router.get('/shifts', requireRole('admin', 'staff'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.listShifts());
}));
router.post('/shifts', requireRole('admin'), asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createShift(req.user!.userId, shiftSchema.parse(req.body)));
}));
router.put('/shifts/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.updateShift(req.user!.userId, id, shiftSchema.partial().parse(req.body)));
}));
router.delete('/shifts/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deleteShift(req.user!.userId, id));
}));

router.get('/templates', requireRole('admin'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.listTemplates());
}));
router.post('/templates', requireRole('admin'), asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createTemplate(req.user!.userId, templateSchema.parse(req.body)));
}));
router.put('/templates/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.updateTemplate(req.user!.userId, id, templateSchema.partial().parse(req.body)));
}));
router.delete('/templates/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deleteTemplate(req.user!.userId, id));
}));
router.get('/preferences', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await scheduleService.listPreferences(req.query.staff_id as string | undefined));
}));
router.post('/preferences', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const body = {
    staffId: req.body.staffId || req.user!.userId,
    shiftId: req.body.shiftId,
    zoneId: req.body.zoneId,
    priority: req.body.priority,
  };
  res.status(201).json(await scheduleService.createPreference(req.user!.userId, body));
}));
router.delete('/preferences/:id', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deletePreference(req.user!.userId, id));
}));
router.post('/generate-from-template', requireRole('admin'), asyncHandler(async (req, res) => {
  const { from, to } = rangeSchema.parse(req.body);
  res.json(await scheduleService.generateFromTemplate(req.user!.userId, from, to));
}));

router.get('/assignments', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  res.json(await scheduleService.listAssignments({
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    staffId: req.query.staff_id as string | undefined,
    zoneId: req.query.zone_id as string | undefined,
    status: req.query.status as string | undefined,
  }));
}));
router.post('/assignments', requireRole('admin'), asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createAssignment(req.user!.userId, assignmentSchema.parse(req.body)));
}));
router.put('/assignments/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.updateAssignment(req.user!.userId, id, assignmentPatchSchema.parse(req.body)));
}));
router.post('/assignments/:id/move', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.moveAssignment(req.user!.userId, id, assignmentPatchSchema.parse(req.body)));
}));
router.delete('/assignments/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.deleteAssignment(req.user!.userId, id));
}));

router.get('/availability', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await scheduleService.listAvailability({
    staffId: req.query.staff_id as string | undefined,
    status: req.query.status as string | undefined,
  }));
}));
router.post('/availability/:id/approve', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.reviewAvailability(req.user!.userId, id, 'approved'));
}));
router.post('/availability/:id/reject', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.reviewAvailability(req.user!.userId, id, 'rejected'));
}));

router.get('/me', auth, asyncHandler(async (req, res) => {
  res.json(await scheduleService.listMine(req.user!.userId, req.query.from as string | undefined, req.query.to as string | undefined));
}));
router.get('/me/availability', auth, asyncHandler(async (req, res) => {
  res.json(await scheduleService.listAvailability({ staffId: req.user!.userId }));
}));
router.post('/me/availability', auth, asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createAvailability(req.user!.userId, availabilitySchema.parse(req.body)));
}));

router.get('/open-shifts', requireRole('admin', 'staff'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.openShifts());
}));

const bidSchema = z.object({ assignmentId: z.string().uuid(), note: z.string().nullable().optional() });
router.post('/bids', auth, asyncHandler(async (req, res) => {
  const { assignmentId, note } = bidSchema.parse(req.body);
  res.status(201).json(await scheduleService.createBid(req.user!.userId, assignmentId, note));
}));
router.get('/bids', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const staffId = req.query.staff_id as string | undefined;
  const status = req.query.status as string | undefined;
  res.json(await scheduleService.listBids(staffId, status));
}));
router.post('/bids/:id/cancel', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.cancelBid(req.user!.userId, id));
}));
router.post('/bids/:id/approve', requireRole('admin'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.reviewBid(req.user!.userId, id, 'approved'));
}));
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
router.post('/swaps', auth, asyncHandler(async (req, res) => {
  res.status(201).json(await scheduleService.createSwap(req.user!.userId, swapSchema.parse(req.body)));
}));
router.get('/swaps', auth, asyncHandler(async (req, res) => {
  const staffId = req.user!.userId;
  const status = req.query.status as string | undefined;
  res.json(await scheduleService.listSwaps(staffId, status));
}));
const swapResponseSchema = z.object({ action: z.enum(['accepted', 'rejected']), responseNote: z.string().nullable().optional() });
router.post('/swaps/:id/respond', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { action, responseNote } = swapResponseSchema.parse(req.body);
  res.json(await scheduleService.respondSwap(req.user!.userId, id, action, responseNote));
}));

router.post('/assignments/:id/confirm', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.confirmAssignment(req.user!.userId, id));
}));
router.post('/assignments/:id/check-in', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const lat = req.body?.lat != null ? Number(req.body.lat) : undefined;
  const lng = req.body?.lng != null ? Number(req.body.lng) : undefined;
  res.json(await scheduleService.checkIn(req.user!.userId, id, req.body?.method || 'web', lat, lng));
}));
router.post('/assignments/:id/check-out', auth, asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await scheduleService.checkOut(req.user!.userId, id));
}));

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
router.get('/geofence', requireRole('admin'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.listGeofenceConfigs());
}));
router.put('/geofence', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await scheduleService.setGeofence(req.user!.userId, geofenceSchema.parse(req.body)));
}));
router.delete('/geofence/:zoneId', requireRole('admin'), asyncHandler(async (req, res) => {
  const { zoneId } = z.object({ zoneId: z.string().uuid() }).parse(req.params);
  res.json(await scheduleService.deleteGeofence(req.user!.userId, zoneId));
}));

router.get('/audit-logs', requireRole('admin'), asyncHandler(async (_req, res) => {
  res.json(await scheduleService.auditLogs());
}));

export default router;
