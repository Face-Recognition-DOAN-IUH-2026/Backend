import { Between, In, Not } from 'typeorm';
import { AppDataSource } from '../data-source';
import {
  LibraryZone,
  ScheduleAuditLog,
  StaffAttendance,
  StaffAvailabilityRequest,
  StaffSchedule,
  StaffScheduleTemplate,
  StaffShift,
} from '../entities';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { UserServiceClient } from '../clients/UserServiceClient';

function toMinutes(time: string) {
  const [hour, minute] = time.split(':').map((part) => parseInt(part, 10));
  return hour * 60 + minute;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class ScheduleService {
  private zones = AppDataSource.getRepository(LibraryZone);
  private shifts = AppDataSource.getRepository(StaffShift);
  private availability = AppDataSource.getRepository(StaffAvailabilityRequest);
  private templates = AppDataSource.getRepository(StaffScheduleTemplate);
  private schedules = AppDataSource.getRepository(StaffSchedule);
  private attendance = AppDataSource.getRepository(StaffAttendance);
  private audit = AppDataSource.getRepository(ScheduleAuditLog);
  private users = new UserServiceClient();

  async listStaff(ids?: string[]) {
    return this.users.listStaff(ids);
  }

  async health() {
    return { status: 'ok', service: 'schedule-service' };
  }

  async createZone(actorId: string, body: Partial<LibraryZone>) {
    const zone = await this.zones.save(this.zones.create(body));
    await this.log('zone.created', 'library_zone', zone.id, actorId, body);
    return zone;
  }

  async listZones() {
    return this.zones.find({ order: { floor: 'ASC', zoneName: 'ASC' } });
  }

  async updateZone(actorId: string, id: string, body: Partial<LibraryZone>) {
    const zone = await this.zones.findOneBy({ id });
    if (!zone) throw new NotFoundError('Zone not found');
    Object.assign(zone, body);
    const saved = await this.zones.save(zone);
    await this.log('zone.updated', 'library_zone', id, actorId, body);
    return saved;
  }

  async deleteZone(actorId: string, id: string) {
    const zone = await this.zones.findOneBy({ id });
    if (!zone) throw new NotFoundError('Zone not found');
    zone.isActive = false;
    await this.zones.save(zone);
    const cancelledCount = await this.cancelAssignmentsForTarget(actorId, { zoneId: id }, 'zone.deactivated');
    await this.log('zone.deactivated', 'library_zone', id, actorId, { cancelledAssignments: cancelledCount });
    return { deleted: true, id, cancelledAssignments: cancelledCount };
  }

  async createShift(actorId: string, body: Partial<StaffShift>) {
    const shift = await this.shifts.save(this.shifts.create(body));
    await this.log('shift.created', 'staff_shift', shift.id, actorId, body);
    return shift;
  }

  async listShifts() {
    return this.shifts.find({ order: { startTime: 'ASC' } });
  }

  async updateShift(actorId: string, id: string, body: Partial<StaffShift>) {
    const shift = await this.shifts.findOneBy({ id });
    if (!shift) throw new NotFoundError('Shift not found');
    Object.assign(shift, body);
    const saved = await this.shifts.save(shift);
    await this.log('shift.updated', 'staff_shift', id, actorId, body);
    return saved;
  }

  async deleteShift(actorId: string, id: string) {
    const shift = await this.shifts.findOneBy({ id });
    if (!shift) throw new NotFoundError('Shift not found');
    shift.isActive = false;
    await this.shifts.save(shift);
    const cancelledCount = await this.cancelAssignmentsForTarget(actorId, { shiftId: id }, 'shift.deactivated');
    await this.log('shift.deactivated', 'staff_shift', id, actorId, { cancelledAssignments: cancelledCount });
    return { deleted: true, id, cancelledAssignments: cancelledCount };
  }

  async createTemplate(actorId: string, body: Partial<StaffScheduleTemplate>) {
    await this.ensureScheduleTargets(body.staffId!, body.shiftId!, body.zoneId!);
    const template = await this.templates.save(this.templates.create(body));
    await this.log('template.created', 'staff_schedule_template', template.id, actorId, body);
    return template;
  }

  async listTemplates() {
    return this.templates.find({ order: { dayOfWeek: 'ASC', createdAt: 'DESC' } });
  }

  async updateTemplate(actorId: string, id: string, body: Partial<StaffScheduleTemplate>) {
    const template = await this.templates.findOneBy({ id });
    if (!template) throw new NotFoundError('Template not found');
    const next = { ...template, ...body };
    await this.ensureScheduleTargets(next.staffId, next.shiftId, next.zoneId);
    Object.assign(template, body);
    const saved = await this.templates.save(template);
    await this.log('template.updated', 'staff_schedule_template', id, actorId, body);
    return saved;
  }

  async deleteTemplate(actorId: string, id: string) {
    const template = await this.templates.findOneBy({ id });
    if (!template) throw new NotFoundError('Template not found');
    template.isActive = false;
    await this.templates.save(template);
    await this.log('template.deactivated', 'staff_schedule_template', id, actorId, null);
    return { deleted: true, id };
  }

  async generateFromTemplate(actorId: string, from: string, to: string) {
    const templates = await this.templates.findBy({ isActive: true });
    const created: StaffSchedule[] = [];
    const cursor = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cursor <= end) {
      const day = cursor.getDay();
      const workDate = localDate(cursor);
      for (const template of templates.filter((item) => item.dayOfWeek === day)) {
        const exists = await this.schedules.findOneBy({
          staffId: template.staffId,
          shiftId: template.shiftId,
          zoneId: template.zoneId,
          workDate,
        });
        if (!exists) {
          created.push(await this.createAssignment(actorId, {
            staffId: template.staffId,
            shiftId: template.shiftId,
            zoneId: template.zoneId,
            workDate,
            note: `Generated from template ${template.name}`,
          }));
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return { created: created.length, items: created };
  }

  async listAssignments(filters: { from?: string; to?: string; staffId?: string; zoneId?: string; status?: string }) {
    const where: any = {};
    if (filters.from && filters.to) where.workDate = Between(filters.from, filters.to);
    if (filters.staffId) where.staffId = filters.staffId;
    if (filters.zoneId) where.zoneId = filters.zoneId;
    if (filters.status) {
      where.status = filters.status;
    } else {
      where.status = Not(In(['cancelled']));
    }
    const items = await this.schedules.find({ where, order: { workDate: 'ASC', createdAt: 'ASC' } });
    const activeItems = filters.status ? items : await this.filterActiveScheduleTargets(items);
    return this.enrichAssignments(activeItems);
  }

  async createAssignment(actorId: string, body: Partial<StaffSchedule>) {
    await this.ensureScheduleTargets(body.staffId!, body.shiftId!, body.zoneId!);
    await this.ensureNoOverlap(body.staffId!, body.shiftId!, body.workDate!);
    await this.ensureNoApprovedLeave(body.staffId!, body.workDate!);
    const schedule = await this.schedules.save(this.schedules.create({
      staffId: body.staffId!,
      shiftId: body.shiftId!,
      zoneId: body.zoneId!,
      workDate: body.workDate!,
      assignedBy: actorId || null,
      note: body.note ?? null,
      status: body.status ?? 'scheduled',
    }));
    await this.log('assignment.created', 'staff_schedule', schedule.id, actorId, body);
    return schedule;
  }

  async updateAssignment(actorId: string, id: string, body: Partial<StaffSchedule>) {
    const schedule = await this.schedules.findOneBy({ id });
    if (!schedule) throw new NotFoundError('Assignment not found');
    const next = { ...schedule, ...body };
    await this.ensureScheduleTargets(next.staffId, next.shiftId, next.zoneId);
    await this.ensureNoOverlap(next.staffId, next.shiftId, next.workDate, id);
    await this.ensureNoApprovedLeave(next.staffId, next.workDate);
    Object.assign(schedule, body);
    const saved = await this.schedules.save(schedule);
    await this.log('assignment.updated', 'staff_schedule', id, actorId, body);
    return saved;
  }

  async moveAssignment(actorId: string, id: string, body: Partial<StaffSchedule>) {
    const moved = await this.updateAssignment(actorId, id, body);
    await this.log('assignment.moved', 'staff_schedule', id, actorId, body);
    return moved;
  }

  async deleteAssignment(actorId: string, id: string) {
    const schedule = await this.schedules.findOneBy({ id });
    if (!schedule) throw new NotFoundError('Assignment not found');
    schedule.status = 'cancelled';
    await this.schedules.save(schedule);
    await this.log('assignment.cancelled', 'staff_schedule', id, actorId, null);
    return { deleted: true, id };
  }

  async createAvailability(staffId: string, body: Partial<StaffAvailabilityRequest>) {
    const item = await this.availability.save(this.availability.create({
      staffId,
      dateFrom: body.dateFrom!,
      dateTo: body.dateTo!,
      type: body.type ?? 'unavailable',
      reason: body.reason ?? null,
      status: 'pending',
    }));
    await this.log('availability.created', 'staff_availability_request', item.id, staffId, body);
    return item;
  }

  async listAvailability(filters: { staffId?: string; status?: string }) {
    const where: any = {};
    if (filters.staffId) where.staffId = filters.staffId;
    if (filters.status) where.status = filters.status;
    return this.availability.find({ where, order: { createdAt: 'DESC' } });
  }

  async reviewAvailability(actorId: string, id: string, status: 'approved' | 'rejected') {
    const item = await this.availability.findOneBy({ id });
    if (!item) throw new NotFoundError('Availability request not found');
    item.status = status;
    item.reviewedBy = actorId || null;
    item.reviewedAt = new Date();
    await this.availability.save(item);
    await this.log(`availability.${status}`, 'staff_availability_request', id, actorId, null);
    return item;
  }

  async listMine(staffId: string, from?: string, to?: string) {
    return this.listAssignments({ staffId, from, to });
  }

  async confirmAssignment(staffId: string, id: string) {
    const schedule = await this.requireOwnedSchedule(staffId, id);
    if (schedule.status === 'cancelled') throw new ConflictError('Assignment is cancelled');
    schedule.status = 'confirmed';
    await this.schedules.save(schedule);
    await this.log('assignment.confirmed', 'staff_schedule', id, staffId, null);
    return schedule;
  }

  async checkIn(staffId: string, id: string, method = 'web') {
    const schedule = await this.requireOwnedSchedule(staffId, id);
    if (schedule.status === 'cancelled' || schedule.status === 'completed') {
      throw new ConflictError('Assignment is not active');
    }
    const existing = await this.attendance.findOneBy({ scheduleId: id });
    if (existing?.checkInAt) throw new ConflictError('Already checked in');
    const shift = await this.requireShift(schedule.shiftId);
    const now = new Date();
    const status = now > new Date(`${schedule.workDate}T${shift.startTime}`) ? 'late' : 'on_time';
    const item = existing ?? this.attendance.create({ scheduleId: id, staffId, status, method });
    item.checkInAt = now;
    item.status = status;
    item.method = method;
    await this.attendance.save(item);
    schedule.status = 'in_progress';
    await this.schedules.save(schedule);
    await this.log('attendance.checked_in', 'staff_attendance', item.id, staffId, { scheduleId: id, status });
    return { schedule, attendance: item };
  }

  async checkOut(staffId: string, id: string) {
    const schedule = await this.requireOwnedSchedule(staffId, id);
    const item = await this.attendance.findOneBy({ scheduleId: id });
    if (!item?.checkInAt) throw new ConflictError('Cannot check out before check in');
    if (item.checkOutAt) throw new ConflictError('Already checked out');
    const shift = await this.requireShift(schedule.shiftId);
    const now = new Date();
    const status = now < new Date(`${schedule.workDate}T${shift.endTime}`) ? 'left_early' : 'completed';
    item.checkOutAt = now;
    item.status = status;
    await this.attendance.save(item);
    schedule.status = 'completed';
    await this.schedules.save(schedule);
    await this.log('attendance.checked_out', 'staff_attendance', item.id, staffId, { scheduleId: id, status });
    return { schedule, attendance: item };
  }

  async auditLogs() {
    return this.audit.find({ order: { createdAt: 'DESC' }, take: 200 });
  }

  private async ensureScheduleTargets(staffId: string, shiftId: string, zoneId: string) {
    await this.users.requireActiveStaff(staffId);
    await this.requireShift(shiftId);
    const zone = await this.zones.findOneBy({ id: zoneId, isActive: true });
    if (!zone) throw new NotFoundError('Zone not found');
  }

  private async cancelAssignmentsForTarget(
    actorId: string,
    target: { zoneId?: string; shiftId?: string },
    reason: string,
  ) {
    const where: any = {
      ...target,
      status: Not(In(['cancelled', 'completed'])),
    };
    const assignments = await this.schedules.find({ where });
    if (!assignments.length) return 0;

    await this.schedules.save(assignments.map((item) => ({
      ...item,
      status: 'cancelled',
      note: item.note ? `${item.note}\nCancelled by ${reason}` : `Cancelled by ${reason}`,
    })));

    await Promise.all(assignments.map((item) => (
      this.log('assignment.cancelled_by_config_delete', 'staff_schedule', item.id, actorId, {
        reason,
        zoneId: target.zoneId ?? null,
        shiftId: target.shiftId ?? null,
      })
    )));

    return assignments.length;
  }

  private async requireShift(shiftId: string) {
    const shift = await this.shifts.findOneBy({ id: shiftId, isActive: true });
    if (!shift) throw new NotFoundError('Shift not found');
    return shift;
  }

  private async filterActiveScheduleTargets(items: StaffSchedule[]) {
    if (!items.length) return items;
    const shiftIds = [...new Set(items.map((item) => item.shiftId))];
    const zoneIds = [...new Set(items.map((item) => item.zoneId))];
    const [activeShifts, activeZones] = await Promise.all([
      this.shifts.findBy({ id: In(shiftIds), isActive: true }),
      this.zones.findBy({ id: In(zoneIds), isActive: true }),
    ]);
    const activeShiftIds = new Set(activeShifts.map((item) => item.id));
    const activeZoneIds = new Set(activeZones.map((item) => item.id));
    return items.filter((item) => activeShiftIds.has(item.shiftId) && activeZoneIds.has(item.zoneId));
  }

  private async ensureNoOverlap(staffId: string, shiftId: string, workDate: string, exceptId?: string) {
    const nextShift = await this.requireShift(shiftId);
    const where: any = { staffId, workDate, status: Not(In(['cancelled', 'completed'])) };
    if (exceptId) where.id = Not(exceptId);
    const existing = await this.schedules.find({ where });
    const existingShifts = existing.length
      ? await this.shifts.findBy({ id: In(existing.map((item) => item.shiftId)) })
      : [];
    for (const item of existing) {
      const shift = existingShifts.find((candidate) => candidate.id === item.shiftId);
      if (shift && overlaps(nextShift.startTime, nextShift.endTime, shift.startTime, shift.endTime)) {
        throw new ConflictError('Staff already has an overlapping shift');
      }
    }
  }

  private async ensureNoApprovedLeave(staffId: string, workDate: string) {
    const leave = await this.availability
      .createQueryBuilder('availability')
      .where('availability.staff_id = :staffId', { staffId })
      .andWhere('availability.status = :status', { status: 'approved' })
      .andWhere(':workDate BETWEEN availability.date_from AND availability.date_to', { workDate })
      .getOne();
    if (leave) throw new ConflictError('Staff has approved unavailable time on this date');
  }

  private async requireOwnedSchedule(staffId: string, id: string) {
    const schedule = await this.schedules.findOneBy({ id });
    if (!schedule) throw new NotFoundError('Assignment not found');
    if (schedule.staffId !== staffId) throw new ForbiddenError('Cannot operate on another staff schedule');
    return schedule;
  }

  private async enrichAssignments(items: StaffSchedule[]) {
    const shiftIds = [...new Set(items.map((item) => item.shiftId))];
    const zoneIds = [...new Set(items.map((item) => item.zoneId))];
    const staffIds = [...new Set(items.map((item) => item.staffId))];
    const [shifts, zones, attendance, staff] = await Promise.all([
      shiftIds.length ? this.shifts.findBy({ id: In(shiftIds) }) : [],
      zoneIds.length ? this.zones.findBy({ id: In(zoneIds) }) : [],
      items.length ? this.attendance.findBy({ scheduleId: In(items.map((item) => item.id)) }) : [],
      staffIds.length ? this.users.listStaff(staffIds) : [],
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        shift: shifts.find((shift) => shift.id === item.shiftId) ?? null,
        zone: zones.find((zone) => zone.id === item.zoneId) ?? null,
        attendance: attendance.find((att) => att.scheduleId === item.id) ?? null,
        staff: staff.find((user) => user.id === item.staffId) ?? null,
      })),
      total: items.length,
    };
  }

  private async log(action: string, entityType: string, entityId: string | null, actorId: string | null, metadata: Record<string, unknown> | null | undefined) {
    await this.audit.save(this.audit.create({
      action,
      entityType,
      entityId,
      actorId: actorId || null,
      metadata: metadata ?? null,
    }));
  }
}

export const scheduleService = new ScheduleService();
