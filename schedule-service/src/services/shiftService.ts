import { Repository } from 'typeorm';
import { AppDataSource } from '../data-source';
import { RedisCacheService } from '../redis';
import {
  StaffShift,
  StaffSchedule,
  StaffScheduleTemplate,
  ScheduleAuditLog,
} from '../entities';
import { NotFoundError } from '../errors';
import { writeAuditLog } from './scheduleAudit';
import { cancelAssignmentsForTarget } from './scheduleConfigCleanup';

/**
 * ShiftService — persistence + audit for staff shifts.
 * Single responsibility: CRUD StaffShift with cache invalidation, audit logging,
 * and cascade deactivation of dependent assignments/templates on delete.
 */
export class ShiftService {
  private shifts: Repository<StaffShift>;
  private schedules: Repository<StaffSchedule>;
  private templates: Repository<StaffScheduleTemplate>;
  private audit: Repository<ScheduleAuditLog>;

  constructor(
    shifts: Repository<StaffShift> = AppDataSource.getRepository(StaffShift),
    schedules: Repository<StaffSchedule> = AppDataSource.getRepository(StaffSchedule),
    templates: Repository<StaffScheduleTemplate> = AppDataSource.getRepository(StaffScheduleTemplate),
    audit: Repository<ScheduleAuditLog> = AppDataSource.getRepository(ScheduleAuditLog),
  ) {
    this.shifts = shifts;
    this.schedules = schedules;
    this.templates = templates;
    this.audit = audit;
  }

  async createShift(actorId: string, body: Partial<StaffShift>) {
    const shift = await this.shifts.save(this.shifts.create(body));
    await RedisCacheService.del('schedule:shifts:list');
    await writeAuditLog(this.audit, 'shift.created', 'staff_shift', shift.id, actorId, body);
    return shift;
  }

  async listShifts() {
    const cached = await RedisCacheService.get<StaffShift[]>('schedule:shifts:list');
    if (cached) return cached;
    const shifts = await this.shifts.find({ order: { startTime: 'ASC' } });
    await RedisCacheService.set('schedule:shifts:list', shifts, 3600);
    return shifts;
  }

  async updateShift(actorId: string, id: string, body: Partial<StaffShift>) {
    const shift = await this.shifts.findOneBy({ id });
    if (!shift) throw new NotFoundError('Shift not found');
    Object.assign(shift, body);
    const saved = await this.shifts.save(shift);
    await RedisCacheService.del('schedule:shifts:list');
    await writeAuditLog(this.audit, 'shift.updated', 'staff_shift', id, actorId, body);
    return saved;
  }

  async deleteShift(actorId: string, id: string) {
    const shift = await this.shifts.findOneBy({ id });
    if (!shift) throw new NotFoundError('Shift not found');
    shift.isActive = false;
    await this.shifts.save(shift);
    await RedisCacheService.del('schedule:shifts:list');

    const cancelledCount = await cancelAssignmentsForTarget(
      this.schedules, this.audit, actorId, { shiftId: id }, 'shift.deactivated');

    const templates = await this.templates.findBy({ shiftId: id, isActive: true });
    for (const t of templates) { t.isActive = false; }
    if (templates.length) await this.templates.save(templates);

    await writeAuditLog(this.audit, 'shift.deactivated', 'staff_shift', id, actorId, {
      cancelledAssignments: cancelledCount,
      deactivatedTemplates: templates.length,
    });
    return { deleted: true, id, cancelledAssignments: cancelledCount };
  }
}
