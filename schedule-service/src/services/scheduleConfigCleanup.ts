import { Repository, In, Not } from 'typeorm';
import { StaffSchedule, ScheduleAuditLog } from '../entities';
import { writeAuditLog } from './scheduleAudit';

/**
 * cancelAssignmentsForTarget — soft-cancel every non-cancelled/non-completed
 * assignment tied to a zone or shift that is being deactivated.
 * Shared by ZoneService and ShiftService so the cascade behaviour stays identical.
 *
 * Returns the number of assignments cancelled.
 */
export async function cancelAssignmentsForTarget(
  schedules: Repository<StaffSchedule>,
  audit: Repository<ScheduleAuditLog>,
  actorId: string,
  target: { zoneId?: string; shiftId?: string },
  reason: string,
): Promise<number> {
  const where: any = {
    ...target,
    status: Not(In(['cancelled', 'completed'])),
  };
  const assignments = await schedules.find({ where });
  if (!assignments.length) return 0;

  await schedules.save(assignments.map((item) => ({
    ...item,
    status: 'cancelled',
    note: item.note ? `${item.note}\nCancelled by ${reason}` : `Cancelled by ${reason}`,
  })));

  await Promise.all(assignments.map((item) =>
    writeAuditLog(audit, 'assignment.cancelled_by_config_delete', 'staff_schedule', item.id, actorId, {
      reason,
      zoneId: target.zoneId ?? null,
      shiftId: target.shiftId ?? null,
    })));

  return assignments.length;
}
