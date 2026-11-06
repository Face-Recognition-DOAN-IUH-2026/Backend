import { Repository } from 'typeorm';
import { LibraryZone, StaffShift, StaffSchedule } from '../entities';
import { NotFoundError, ForbiddenError } from '../errors';

type StaffClient = {
  requireActiveStaff(staffId: string): Promise<unknown>;
};

/**
 * requireShift — resolve an active shift or throw NotFoundError.
 * Shared by TemplateService, GeofenceService, AttendanceService and AssignmentService.
 */
export async function requireShift(shifts: Repository<StaffShift>, shiftId: string) {
  const shift = await shifts.findOneBy({ id: shiftId, isActive: true });
  if (!shift) throw new NotFoundError('Shift not found');
  return shift;
}

/**
 * ensureScheduleTargets — validate that staff, shift and zone all exist/active.
 * Shared by TemplateService and AssignmentService so the rule lives in one place.
 */
export async function ensureScheduleTargets(
  users: StaffClient,
  shifts: Repository<StaffShift>,
  zones: Repository<LibraryZone>,
  staffId: string,
  shiftId: string,
  zoneId: string,
): Promise<void> {
  await users.requireActiveStaff(staffId);
  await requireShift(shifts, shiftId);
  const zone = await zones.findOneBy({ id: zoneId, isActive: true });
  if (!zone) throw new NotFoundError('Zone not found');
}

/**
 * requireOwnedSchedule — load an assignment and assert the caller owns it.
 * Shared by AttendanceService, GeofenceService and AssignmentService.
 */
export async function requireOwnedSchedule(
  schedules: Repository<StaffSchedule>,
  staffId: string,
  id: string,
): Promise<StaffSchedule> {
  const schedule = await schedules.findOneBy({ id });
  if (!schedule) throw new NotFoundError('Assignment not found');
  if (schedule.staffId !== staffId) throw new ForbiddenError('Cannot operate on another staff schedule');
  return schedule;
}
