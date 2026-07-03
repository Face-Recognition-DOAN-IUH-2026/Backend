import { Between, In, IsNull, Not } from 'typeorm';
import { getAuditContext } from '../middlewares/auditContext';
import { AppDataSource } from '../data-source';
import { config } from '../config';
import { RedisCacheService } from '../redis';
import {
  LibraryZone,
  ScheduleAuditLog,
  StaffAttendance,
  StaffSchedule,
  StaffScheduleTemplate,
  StaffShift,
  StaffShiftPreference,
  GeofenceConfig,
} from '../entities';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { UserServiceClient } from '../clients/UserServiceClient';
import { publishEvent } from '../utils/eventPublisher';
import { haversineDistanceMeters } from '../utils/geofence';

function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class ScheduleService {
  private zones = AppDataSource.getRepository(LibraryZone);
  private shifts = AppDataSource.getRepository(StaffShift);
  private templates = AppDataSource.getRepository(StaffScheduleTemplate);
  private schedules = AppDataSource.getRepository(StaffSchedule);
  private attendance = AppDataSource.getRepository(StaffAttendance);
  private audit = AppDataSource.getRepository(ScheduleAuditLog);
  private preferences = AppDataSource.getRepository(StaffShiftPreference);
  private geofence = AppDataSource.getRepository(GeofenceConfig);
  private users = new UserServiceClient();

  async listStaff(ids?: string[]) {
    return this.users.listStaff(ids);
  }

  async health() {
    return { status: 'ok', service: 'schedule-service' };
  }

  async createZone(actorId: string, body: Partial<LibraryZone>) {
    const zone = await this.zones.save(this.zones.create(body));
    await RedisCacheService.del('schedule:zones:list');
    await this.log('zone.created', 'library_zone', zone.id, actorId, body);
    return zone;
  }

  async listZones() {
    const cached = await RedisCacheService.get<LibraryZone[]>('schedule:zones:list');
    if (cached) return cached;
    const zones = await this.zones.find({ order: { floor: 'ASC', zoneName: 'ASC' } });
    await RedisCacheService.set('schedule:zones:list', zones, 3600);
    return zones;
  }

  async updateZone(actorId: string, id: string, body: Partial<LibraryZone>) {
    const zone = await this.zones.findOneBy({ id });
    if (!zone) throw new NotFoundError('Zone not found');
    Object.assign(zone, body);
    const saved = await this.zones.save(zone);
    await RedisCacheService.del('schedule:zones:list');
    await this.log('zone.updated', 'library_zone', id, actorId, body);
    return saved;
  }

  async deleteZone(actorId: string, id: string) {
    const zone = await this.zones.findOneBy({ id });
    if (!zone) throw new NotFoundError('Zone not found');
    zone.isActive = false;
    await this.zones.save(zone);
    await RedisCacheService.del('schedule:zones:list');
    const cancelledCount = await this.cancelAssignmentsForTarget(actorId, { zoneId: id }, 'zone.deactivated');

    const templates = await this.templates.findBy({ zoneId: id, isActive: true });
    for (const t of templates) { t.isActive = false; }
    if (templates.length) await this.templates.save(templates);

    await this.log('zone.deactivated', 'library_zone', id, actorId, { cancelledAssignments: cancelledCount, deactivatedTemplates: templates.length });
    return { deleted: true, id, cancelledAssignments: cancelledCount };
  }

  async createShift(actorId: string, body: Partial<StaffShift>) {
    const shift = await this.shifts.save(this.shifts.create(body));
    await RedisCacheService.del('schedule:shifts:list');
    await this.log('shift.created', 'staff_shift', shift.id, actorId, body);
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
    await this.log('shift.updated', 'staff_shift', id, actorId, body);
    return saved;
  }

  async deleteShift(actorId: string, id: string) {
    const shift = await this.shifts.findOneBy({ id });
    if (!shift) throw new NotFoundError('Shift not found');
    shift.isActive = false;
    await this.shifts.save(shift);
    await RedisCacheService.del('schedule:shifts:list');
    const cancelledCount = await this.cancelAssignmentsForTarget(actorId, { shiftId: id }, 'shift.deactivated');

    const templates = await this.templates.findBy({ shiftId: id, isActive: true });
    for (const t of templates) { t.isActive = false; }
    if (templates.length) await this.templates.save(templates);

    await this.log('shift.deactivated', 'staff_shift', id, actorId, { cancelledAssignments: cancelledCount, deactivatedTemplates: templates.length });
    return { deleted: true, id, cancelledAssignments: cancelledCount };
  }

  async createTemplate(actorId: string, body: Partial<StaffScheduleTemplate>) {
    await this.ensureScheduleTargets(body.staffId!, body.shiftId!, body.zoneId!);
    const template = await this.templates.save(this.templates.create(body));
    await this.log('template.created', 'staff_schedule_template', template.id, actorId, body);
    return template;
  }

  async listTemplates() {
    return this.templates.find({ where: { isActive: true }, order: { dayOfWeek: 'ASC', createdAt: 'DESC' } });
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

  async listPreferences(staffId?: string, page?: number, limit?: number) {
    const where: any = { isActive: true };
    if (staffId) where.staffId = staffId;
    const p = page || 1;
    const l = limit || 100;
    const [items, total] = await this.preferences.findAndCount({
      where,
      order: { priority: 'ASC', createdAt: 'DESC' },
      skip: (p - 1) * l,
      take: l,
    });
    const shiftIds = [...new Set(items.map((i) => i.shiftId))];
    const zoneIds = [...new Set(items.map((i) => i.zoneId))];
    const [shifts, zones] = await Promise.all([
      shiftIds.length ? this.shifts.findBy({ id: In(shiftIds) }) : [],
      zoneIds.length ? this.zones.findBy({ id: In(zoneIds) }) : [],
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        shift: shifts.find((s) => s.id === item.shiftId) ?? null,
        zone: zones.find((z) => z.id === item.zoneId) ?? null,
      })),
      total,
      page: p,
      limit: l,
    };
  }

  async createPreference(actorId: string, body: { staffId: string; shiftId: string; zoneId: string; priority?: number }) {
    const existing = await this.preferences.findOneBy({ staffId: body.staffId, shiftId: body.shiftId, zoneId: body.zoneId });
    if (existing) {
      existing.priority = body.priority ?? existing.priority;
      existing.isActive = true;
      await this.preferences.save(existing);
      await this.log('preference.updated', 'staff_shift_preference', existing.id, actorId, body);
      return existing;
    }
    const pref = await this.preferences.save(this.preferences.create({ ...body, priority: body.priority ?? 1 }));
    await this.log('preference.created', 'staff_shift_preference', pref.id, actorId, body);
    return pref;
  }

  async deletePreference(actorId: string, id: string) {
    const pref = await this.preferences.findOneBy({ id });
    if (!pref) throw new NotFoundError('Preference not found');
    pref.isActive = false;
    await this.preferences.save(pref);
    await this.log('preference.deactivated', 'staff_shift_preference', id, actorId, null);
    return { deleted: true, id };
  }

  async getPreferencesForStaff(staffId: string) {
    return this.preferences.find({ where: { staffId, isActive: true }, order: { priority: 'ASC' } });
  }

  async generateFromTemplate(actorId: string, from: string, to: string) {
    const templates = await this.templates.findBy({ isActive: true });
    const created: StaffSchedule[] = [];
    const cursor = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cursor <= end) {
      const day = cursor.getDay();
      const workDate = localDate(cursor);
      for (const template of templates.filter((item) => {
        if (item.dayOfWeek !== day) return false;
        if (item.validFrom && workDate < item.validFrom) return false;
        if (item.validTo && workDate > item.validTo) return false;
        return true;
      })) {
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

  async listAssignments(filters: { from?: string; to?: string; staffId?: string; zoneId?: string; shiftId?: string; status?: string; page?: number; limit?: number }) {
    const where: any = {};
    if (filters.from && filters.to) where.workDate = Between(filters.from, filters.to);
    if (filters.staffId) where.staffId = filters.staffId;
    if (filters.zoneId) where.zoneId = filters.zoneId;
    if (filters.shiftId) where.shiftId = filters.shiftId;
    if (filters.status) {
      where.status = filters.status;
    } else {
      where.status = Not(In(['cancelled']));
    }
    const page = filters.page || 1;
    const limit = filters.limit || 100;
    const [items, total] = await this.schedules.findAndCount({
      where,
      order: { workDate: 'ASC', createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const activeItems = filters.status ? items : await this.filterActiveScheduleTargets(items);
    const enriched = await this.enrichAssignments(activeItems);
    return { items: enriched.items, total, page, limit };
  }

  private advisoryLockKey(shiftId: string, zoneId: string, workDate: string): number {
    let hash = 0;
    const str = `${shiftId}::${zoneId}::${workDate}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash);
  }

  async createAssignment(actorId: string, body: Partial<StaffSchedule>, force?: boolean) {
    await this.ensureScheduleTargets(body.staffId!, body.shiftId!, body.zoneId!);
    const warnings: string[] = [];

    const dupWarning = await this.ensureNoDuplicateAssignment(body.staffId!, body.shiftId!, body.zoneId!, body.workDate!, undefined, force);
    if (dupWarning) warnings.push(dupWarning);


    await this.ensureFutureDate(body.workDate!);

    const zoneWarning = await this.ensureNoZoneConflictOnSameDay(body.staffId!, body.zoneId!, body.workDate!, undefined, force);
    if (zoneWarning) warnings.push(zoneWarning);

    const overlapWarning = await this.ensureNoShiftTimeOverlap(body.staffId!, body.shiftId!, body.workDate!, undefined, force);
    if (overlapWarning) warnings.push(overlapWarning);

    const { overstaffWarning, schedule } = await AppDataSource.transaction(async (manager) => {
      const lockKey = this.advisoryLockKey(body.shiftId!, body.zoneId!, body.workDate!);
      await manager.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

      const overstaffWarningInner = await this.ensureNoOverstaffing(body.shiftId!, body.zoneId!, body.workDate!, force, manager);
      const newSchedule = await manager.save(StaffSchedule, manager.create(StaffSchedule, {
        staffId: body.staffId!,
        shiftId: body.shiftId!,
        zoneId: body.zoneId!,
        workDate: body.workDate!,
        assignedBy: actorId || null,
        note: body.note ?? null,
        status: body.status ?? 'scheduled',
      }));
      return { overstaffWarning: overstaffWarningInner, schedule: newSchedule };
    });

    if (overstaffWarning) warnings.push(overstaffWarning);

    await this.log(force ? 'assignment.force_created' : 'assignment.created', 'staff_schedule', schedule.id, actorId, { ...body, force, warnings });

    const shift = await this.shifts.findOneBy({ id: body.shiftId! });
    publishEvent('schedule.changed', {
      staffId: body.staffId,
      shiftId: body.shiftId,
      shiftName: shift?.name || null,
      workDate: body.workDate,
      changeType: 'assigned',
    });

    return warnings.length ? { ...schedule, warnings } : schedule;
  }

  async updateAssignment(actorId: string, id: string, body: Partial<StaffSchedule>, force?: boolean) {
    const schedule = await this.schedules.findOneBy({ id });
    if (!schedule) throw new NotFoundError('Assignment not found');
    const next = { ...schedule, ...body };
    await this.ensureScheduleTargets(next.staffId, next.shiftId, next.zoneId);
    const warnings: string[] = [];

    const dupWarning = await this.ensureNoDuplicateAssignment(next.staffId, next.shiftId, next.zoneId, next.workDate, id, force);
    if (dupWarning) warnings.push(dupWarning);


    const zoneWarning = await this.ensureNoZoneConflictOnSameDay(next.staffId, next.zoneId, next.workDate, id, force);
    if (zoneWarning) warnings.push(zoneWarning);

    const overlapWarning = await this.ensureNoShiftTimeOverlap(next.staffId, next.shiftId, next.workDate, id, force);
    if (overlapWarning) warnings.push(overlapWarning);

    const { overstaffWarning, saved } = await AppDataSource.transaction(async (manager) => {
      const lockKey = this.advisoryLockKey(next.shiftId, next.zoneId, next.workDate);
      await manager.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

      const overstaffWarningInner = await this.ensureNoOverstaffing(next.shiftId, next.zoneId, next.workDate, force, manager);
      Object.assign(schedule, body);
      const updated = await manager.save(StaffSchedule, schedule);
      return { overstaffWarning: overstaffWarningInner, saved: updated };
    });

    if (overstaffWarning) warnings.push(overstaffWarning);

    await this.log(force ? 'assignment.force_updated' : 'assignment.updated', 'staff_schedule', id, actorId, { ...body, force, warnings });

    const updatedShift = await this.shifts.findOneBy({ id: next.shiftId! });
    publishEvent('schedule.changed', {
      staffId: next.staffId,
      shiftId: next.shiftId,
      shiftName: updatedShift?.name || null,
      workDate: next.workDate,
      changeType: 'updated',
    });

    return warnings.length ? { ...saved, warnings } : saved;
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

    const cancelledShift = await this.shifts.findOneBy({ id: schedule.shiftId! });
    publishEvent('schedule.changed', {
      staffId: schedule.staffId,
      shiftId: schedule.shiftId,
      shiftName: cancelledShift?.name || null,
      workDate: schedule.workDate,
      changeType: 'cancelled',
    });

    return { deleted: true, id };
  }

  async deleteWeekAssignments(actorId: string, from: string, to: string, notify: boolean) {
    const today = new Date().toISOString().split('T')[0];

    // Only cancel future/today assignments (not past)
    const effectiveFrom = from < today ? today : from;

    if (effectiveFrom > to) {
      return { cancelled: 0, skipped: 0, message: 'Không có ca nào trong tương lai để hủy' };
    }

    const candidates = await this.schedules.find({
      where: {
        workDate: Between(effectiveFrom, to),
        status: Not(In(['cancelled', 'completed'])),
      },
    });

    if (!candidates.length) {
      return { cancelled: 0, skipped: 0, message: 'Không có ca nào cần hủy' };
    }

    // Cancel all
    await this.schedules.save(candidates.map((s) => ({
      ...s,
      status: 'cancelled',
      note: s.note ? `${s.note}\nHủy hàng loạt bởi admin` : 'Hủy hàng loạt bởi admin',
    })));

    await Promise.all(candidates.map((s) =>
      this.log('assignment.bulk_cancelled', 'staff_schedule', s.id, actorId, { from, to, notify })
    ));

    // Publish notification events if requested
    if (notify) {
      const shiftIds = [...new Set(candidates.map((s) => s.shiftId!).filter(Boolean))];
      const shiftList = shiftIds.length ? await this.shifts.findBy({ id: In(shiftIds) }) : [];
      const shiftNameMap = new Map(shiftList.map((s) => [s.id, s.name]));

      for (const s of candidates) {
        publishEvent('schedule.changed', {
          staffId: s.staffId,
          shiftId: s.shiftId,
          shiftName: s.shiftId ? shiftNameMap.get(s.shiftId) || null : null,
          workDate: s.workDate,
          changeType: 'cancelled',
        });
      }
    }

    return {
      cancelled: candidates.length,
      skipped: from < today ? (await this.schedules.count({ where: { workDate: Between(from, today), status: Not(In(['cancelled'])) } })) : 0,
      message: `Đã hủy ${candidates.length} ca trực${notify ? ' và gửi thông báo' : ''}`,
    };
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

  async adminConfirmAssignment(actorId: string, id: string) {
    const schedule = await this.schedules.findOneBy({ id });
    if (!schedule) throw new NotFoundError('Assignment not found');
    if (schedule.status === 'cancelled') throw new ConflictError('Assignment is cancelled');
    schedule.status = 'confirmed';
    schedule.assignedBy = actorId;
    await this.schedules.save(schedule);
    await this.log('assignment.admin_confirmed', 'staff_schedule', id, actorId, null);
    return schedule;
  }

  async adminFixAttendance(actorId: string, scheduleId: string, body: { checkInAt?: string; checkOutAt?: string; status?: string }) {
    const schedule = await this.schedules.findOneBy({ id: scheduleId });
    if (!schedule) throw new NotFoundError('Assignment not found');

    let att = await this.attendance.findOneBy({ scheduleId });
    if (!att) {
      att = this.attendance.create({
        scheduleId,
        staffId: schedule.staffId,
        status: body.status || 'completed',
        method: 'admin_fix',
      });
    }
    if (body.checkInAt) att.checkInAt = new Date(body.checkInAt);
    if (body.checkOutAt) att.checkOutAt = new Date(body.checkOutAt);
    if (body.status) att.status = body.status;

    await this.attendance.save(att);
    await this.log('attendance.admin_fixed', 'staff_attendance', att.id, actorId, {
      scheduleId,
      changes: body,
    });
    return att;
  }

  // checkIn moved above
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

  async autoCheckoutStaleAssignments() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = localDate(now);

    const staleAssignments = await this.schedules
      .createQueryBuilder('s')
      .innerJoin('staff_shifts', 'sh', 'sh.id = s.shift_id')
      .where('s.status = :status', { status: 'in_progress' })
      .andWhere('s.work_date <= :today', { today })
      .andWhere('sh.end_time <= :time', { time: currentTime })
      .getMany();

    let checkedOut = 0;
    for (const asg of staleAssignments) {
      const att = await this.attendance.findOneBy({ scheduleId: asg.id });
      if (att && !att.checkOutAt) {
        const shift = await this.requireShift(asg.shiftId);
        const shiftEnd = new Date(`${asg.workDate}T${shift.endTime}`);
        att.checkOutAt = shiftEnd;
        att.status = 'auto_checkout';
        await this.attendance.save(att);
        asg.status = 'completed';
        await this.schedules.save(asg);
        await this.log('attendance.auto_checkout', 'staff_attendance', att.id, null, {
          scheduleId: asg.id,
          reason: 'shift ended without checkout',
        });
        checkedOut++;
      }
    }
    return { checkedOut };
  }


  async createAssignmentsBulk(actorId: string, items: Array<{ staffId: string; shiftId: string; zoneId: string; workDate: string; note?: string | null; status?: string }>, force?: boolean) {
    await Promise.all(items.map((item) =>
      Promise.all([
        this.ensureScheduleTargets(item.staffId, item.shiftId, item.zoneId),
        this.ensureFutureDate(item.workDate),
      ])
    ));

    const shiftIds = [...new Set(items.map(item => item.shiftId))];
    const activeShifts = await this.shifts.find({ where: { id: In(shiftIds), isActive: true } });
    const shiftMap = new Map(activeShifts.map(s => [s.id, s]));

    const staffIds = [...new Set(items.map(item => item.staffId))];
    const dates = [...new Set(items.map(item => item.workDate))];
    const dbAssignments = await this.schedules.find({
      where: {
        staffId: In(staffIds),
        workDate: In(dates),
        status: Not(In(['cancelled']))
      }
    });

    const currentAssignments = [...dbAssignments];

    const uniqueKeys = [...new Set(items.map(item => `${item.shiftId}:${item.zoneId}:${item.workDate}`))];
    const capacityCounts = new Map<string, number>();

    if (uniqueKeys.length > 0) {
      const counts = await this.schedules
        .createQueryBuilder('s')
        .select("s.shift_id || ':' || s.zone_id || ':' || s.work_date", 'combo_key')
        .addSelect('COUNT(*)', 'cnt')
        .where('s.status NOT IN (:...statuses)', { statuses: ['cancelled', 'completed'] })
        .groupBy("s.shift_id || ':' || s.zone_id || ':' || s.work_date")
        .getRawMany();

      for (const row of counts) {
        if (uniqueKeys.includes(row.combo_key)) {
          capacityCounts.set(row.combo_key, parseInt(row.cnt, 10));
        }
      }
    }

    const existingShiftIds = [...new Set(dbAssignments.map(a => a.shiftId).filter(id => !shiftMap.has(id)))];
    if (existingShiftIds.length > 0) {
      const extraShifts = await this.shifts.findBy({ id: In(existingShiftIds) });
      for (const s of extraShifts) shiftMap.set(s.id, s);
    }

    const auditEntries: Array<{ action: string; entity: string; entityId: string; actorId: string; data: any }> = [];

    const result = await AppDataSource.transaction(async (transactionalEntityManager) => {
      const virtualAssignments = [...currentAssignments];
      const toSave: Array<{ staffId: string; shiftId: string; zoneId: string; workDate: string; assignedBy: string | null; note: string | null; status: string }> = [];

      for (const item of items) {
        const key = `${item.shiftId}:${item.zoneId}:${item.workDate}`;
        const shiftDef = shiftMap.get(item.shiftId);
        if (!shiftDef) throw new NotFoundError('Shift not found or inactive');

        if (shiftDef.maxStaff) {
          const currentCount = capacityCounts.get(key) || 0;
          if (currentCount >= shiftDef.maxStaff && !force) {
            throw new ConflictError(`Shift is already at maximum capacity (${shiftDef.maxStaff} staff)`);
          }
          capacityCounts.set(key, currentCount + 1);
        }

        const hasDuplicate = virtualAssignments.some(
          a => a.staffId === item.staffId &&
               a.shiftId === item.shiftId &&
               a.zoneId === item.zoneId &&
               a.workDate === item.workDate &&
               a.status !== 'completed'
        );
        if (hasDuplicate && !force) throw new ConflictError('Staff is already assigned to this shift and zone');

        const dayAssignments = virtualAssignments.filter(a => a.staffId === item.staffId && a.workDate === item.workDate);
        const hasZoneConflict = dayAssignments.some(a => a.zoneId !== item.zoneId);
        if (hasZoneConflict && !force) throw new ConflictError('Staff is already assigned to a different zone on this day');

        const newStart = shiftDef.startTime.slice(0, 5);
        const newEnd = shiftDef.endTime.slice(0, 5);
        for (const existingAsg of dayAssignments) {
          if (existingAsg.shiftId === item.shiftId) continue;

          const existShift = shiftMap.get(existingAsg.shiftId);
          if (!existShift) continue;

          const existStart = existShift.startTime.slice(0, 5);
          const existEnd = existShift.endTime.slice(0, 5);
          if (newStart < existEnd && newEnd > existStart) {
            throw new ConflictError(
              `New shift time (${newStart}-${newEnd}) overlaps with existing shift "${existShift.name}" (${existStart}-${existEnd}) on ${item.workDate}`,
            );
          }
        }

        const status = item.status ?? 'scheduled';
        virtualAssignments.push({ staffId: item.staffId, shiftId: item.shiftId, zoneId: item.zoneId, workDate: item.workDate, status } as any);
        toSave.push({
          staffId: item.staffId,
          shiftId: item.shiftId,
          zoneId: item.zoneId,
          workDate: item.workDate,
          assignedBy: actorId || null,
          note: item.note ?? null,
          status,
        });

        auditEntries.push({ action: 'assignment.created', entity: 'staff_schedule', entityId: '', actorId, data: item });

        publishEvent('schedule.changed', {
          staffId: item.staffId,
          shiftId: item.shiftId,
          shiftName: shiftDef.name || null,
          workDate: item.workDate,
          changeType: 'assigned',
        });
      }

      if (toSave.length === 0) return [];

      const entities = toSave.map(data => transactionalEntityManager.create(StaffSchedule, data));
      const savedEntities = await transactionalEntityManager.save(StaffSchedule, entities);

      for (let i = 0; i < savedEntities.length; i++) {
        auditEntries[i].entityId = savedEntities[i].id;
      }

      return savedEntities;
    });

    for (const entry of auditEntries) {
      await this.log(entry.action, entry.entity, entry.entityId, entry.actorId, entry.data);
    }

    return result;
  }

  async autoSchedule(actorId: string, from: string, to: string) {
    const activeShifts = await this.shifts.findBy({ isActive: true });
    const activeZones = await this.zones.findBy({ isActive: true });
    const allStaff = await this.users.listStaff();
    const staff = allStaff.filter((s: any) => s.role === 'admin' || s.role === 'staff');
    const existingAssignments = await this.schedules.find({
      where: { workDate: Between(from, to), status: Not(In(['cancelled'])) },
    });
    
    // Templates with validFrom/validTo date range filtering
    const allTemplates = await this.templates.findBy({ isActive: true });

    let preferences: StaffShiftPreference[] = [];
    try {
      preferences = await this.preferences.find({ where: { isActive: true } });
    } catch {
      // Table might not exist yet, continue without preferences
    }

    const proposed: Array<{ staffId: string; shiftId: string; zoneId: string; workDate: string; note: string }> = [];
    const skipped: string[] = [];
    const today = localDate(new Date());
    const todayDate = new Date(`${today}T00:00:00`);
    const fromDate = new Date(`${from}T00:00:00`);
    if (fromDate < todayDate) fromDate.setTime(todayDate.getTime());
    const cursor = fromDate;
    const end = new Date(`${to}T00:00:00`);
    const actualFrom = localDate(cursor);

    const staffWorkload = new Map<string, number>();
    for (const s of staff) {
      const count = existingAssignments.filter((a) => a.staffId === s.id).length;
      staffWorkload.set(s.id, count);
    }

    const preferencesByShiftZone = new Map<string, string[]>();
    for (const p of preferences) {
      const key = `${p.shiftId}:${p.zoneId}`;
      const list = preferencesByShiftZone.get(key) || [];
      list.push(p.staffId);
      preferencesByShiftZone.set(key, list);
    }

    // Build Maps for O(1) lookups (replaces .find() in inner loops)
    const staffMap = new Map(staff.map(s => [s.id, s]));
    const shiftMap = new Map(activeShifts.map(s => [s.id, s]));
    const zoneMap = new Map(activeZones.map(z => [z.id, z]));

    // Build Set of existing assignment composite keys for O(1) conflict check
    const existingKeys = new Set(
      existingAssignments.map(a => `${a.staffId}:${a.workDate}:${a.shiftId}:${a.zoneId}`)
    );

    // Helper: check time overlap between two shifts
    const shiftsOverlap = (shiftA: typeof activeShifts[0], shiftB: typeof activeShifts[0]) =>
      shiftA.startTime < shiftB.endTime && shiftA.endTime > shiftB.startTime;

    // Helper: get all assignments for a staff on a given day (existing + proposed) using Maps
    const staffDayMap = new Map<string, Array<typeof existingAssignments[0] | typeof proposed[0]>>();
    for (const a of existingAssignments) {
      const key = `${a.staffId}:${a.workDate}`;
      const list = staffDayMap.get(key) || [];
      list.push(a);
      staffDayMap.set(key, list);
    }
    // proposed items are added dynamically below

    const getStaffDayAssignments = (staffId: string, workDate: string) => {
      const key = `${staffId}:${workDate}`;
      const existing = staffDayMap.get(key) || [];
      const newProposed = proposed.filter(p => p.staffId === staffId && p.workDate === workDate);
      return [...existing, ...newProposed];
    };

    const understaffed: Array<{ shiftId: string; zoneId: string; workDate: string; needed: number; shiftName?: string; zoneName?: string }> = [];

    while (cursor <= end) {
      const workDate = localDate(cursor);
      if (workDate < today) { cursor.setDate(cursor.getDate() + 1); continue; }

      const dayOfWeek = cursor.getDay();

      // ── PASS 1: Apply templates (hard assignments) ──────────────────────────
      // Templates that are valid on this specific date and day-of-week
      const validDayTemplates = allTemplates.filter((t) => {
        if (t.dayOfWeek !== dayOfWeek) return false;
        if (t.validFrom && workDate < t.validFrom) return false;
        if (t.validTo && workDate > t.validTo) return false;
        return true;
      });

      for (const t of validDayTemplates) {
        // Skip if staff member is not found in active staff list
        if (!staffMap.has(t.staffId)) continue;
        // Skip if shift or zone no longer active
        if (!shiftMap.has(t.shiftId)) continue;
        if (!zoneMap.has(t.zoneId)) continue;
        // Skip if already assigned (existing or already proposed) — O(1) Set lookup
        const tKey = `${t.staffId}:${workDate}:${t.shiftId}:${t.zoneId}`;
        if (existingKeys.has(tKey)) {
          skipped.push(`template_exists:${t.staffId}:${workDate}`);
          continue;
        }
        if (proposed.some((p) => p.staffId === t.staffId && p.workDate === workDate && p.shiftId === t.shiftId && p.zoneId === t.zoneId)) {
          continue;
        }
        // Skip if zone conflict (already on a different zone that day)
        const dayAssignments = getStaffDayAssignments(t.staffId, workDate);
        const hasZoneConflict = dayAssignments.some((a) => a.zoneId !== t.zoneId);
        if (hasZoneConflict) { skipped.push(`template_zone_conflict:${t.staffId}:${workDate}`); continue; }
        // Skip if shift time overlap
        const templateShift = shiftMap.get(t.shiftId)!;
        const hasTimeOverlap = dayAssignments.some((a) => {
          if (a.shiftId === t.shiftId) return false;
          const existingShift = shiftMap.get(a.shiftId);
          return existingShift ? shiftsOverlap(templateShift, existingShift) : false;
        });
        if (hasTimeOverlap) { skipped.push(`template_time_overlap:${t.staffId}:${workDate}`); continue; }

        proposed.push({ staffId: t.staffId, shiftId: t.shiftId, zoneId: t.zoneId, workDate, note: `Auto-scheduled (template: ${t.name})` });
        staffWorkload.set(t.staffId, (staffWorkload.get(t.staffId) || 0) + 1);
      }

      // ── PASS 2: Fill remaining gaps with scoring algorithm ──────────────────

      for (const shift of activeShifts) {
        for (const zone of activeZones) {
          const existing = existingAssignments.filter((a) => a.workDate === workDate && a.shiftId === shift.id && a.zoneId === zone.id);
          const alreadyProposed = proposed.filter((p) => p.workDate === workDate && p.shiftId === shift.id && p.zoneId === zone.id);
          const currentTotal = existing.length + alreadyProposed.length;
          const neededByMin = Math.max(0, (shift.minStaff || 1) - currentTotal);
          const neededByMax = shift.maxStaff ? Math.max(0, shift.maxStaff - currentTotal) : Infinity;
          const needed = Math.min(neededByMin, neededByMax);
          if (needed <= 0) continue;

          const prefKey = `${shift.id}:${zone.id}`;
          const prefMatchFirst = preferencesByShiftZone.get(prefKey) || [];

          // Sort per shift/zone: preference for THIS shift+zone first, then workload ascending
          const sortedStaff = [...staff].sort((a, b) => {
            const aIsPref = prefMatchFirst.includes(a.id);
            const bIsPref = prefMatchFirst.includes(b.id);
            if (aIsPref && !bIsPref) return -1;
            if (!aIsPref && bIsPref) return 1;
            const aLoad = staffWorkload.get(a.id) || 0;
            const bLoad = staffWorkload.get(b.id) || 0;
            return aLoad - bLoad;
          });

          let assigned = 0;
          for (const s of sortedStaff) {
            if (assigned >= needed) break;
            // Skip if already assigned via template in this pass
            if (proposed.some((p) => p.staffId === s.id && p.workDate === workDate && p.shiftId === shift.id && p.zoneId === zone.id)) continue;
            if (existing.some((e) => e.staffId === s.id)) continue;

            const existingCount = existingAssignments.filter((a) => a.staffId === s.id).length;
            const proposedCount = staffWorkload.get(s.id) || 0;
            const maxShifts = config.maxShiftsPerWeek;
            if (existingCount + proposedCount >= maxShifts) { skipped.push(`max:${s.id}:${workDate}`); continue; }

            const sameDayAssignments = getStaffDayAssignments(s.id, workDate);

            let hasZoneConflict = false;
            for (const a of sameDayAssignments) {
              if (a.zoneId !== zone.id) { hasZoneConflict = true; break; }
            }
            if (hasZoneConflict) { skipped.push(`zone_conflict:${s.id}:${workDate}`); continue; }

            const shiftDef = shiftMap.get(shift.id)!;
            let hasTimeOverlap = false;
            for (const a of sameDayAssignments) {
              if (a.shiftId !== shift.id) {
                const existingShiftDef = shiftMap.get(a.shiftId);
                if (existingShiftDef && shiftsOverlap(shiftDef, existingShiftDef)) {
                  hasTimeOverlap = true;
                  break;
                }
              }
            }
            if (hasTimeOverlap) { skipped.push(`time_overlap:${s.id}:${workDate}`); continue; }

            proposed.push({ staffId: s.id, shiftId: shift.id, zoneId: zone.id, workDate, note: 'Auto-scheduled' });
            staffWorkload.set(s.id, (staffWorkload.get(s.id) || 0) + 1);
            assigned++;
          }

          // Track understaffed zones
          if (assigned < needed) {
            understaffed.push({
              shiftId: shift.id,
              zoneId: zone.id,
              workDate,
              needed: needed - assigned,
              shiftName: (shift as any).name,
              zoneName: (zone as any).name,
            });
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    await this.log('auto_schedule.generated', 'staff_schedule', null, actorId, { from, to, proposed: proposed.length, skipped: skipped.length });
    return { proposed, skipped: skipped.length, total: proposed.length, actualFrom, actualTo: to, understaffed };
  }


  async setGeofence(actorId: string, body: { zoneId: string; latitude: number; longitude: number; radiusMeters?: number; addressHint?: string | null; allowedWifiSsids?: string[] | null }) {
    const zone = await this.zones.findOneBy({ id: body.zoneId, isActive: true });
    if (!zone) throw new NotFoundError('Zone not found');
    const existing = await this.geofence.findOneBy({ zoneId: body.zoneId });
    if (existing) {
      existing.latitude = body.latitude;
      existing.longitude = body.longitude;
      existing.radiusMeters = body.radiusMeters ?? existing.radiusMeters;
      existing.addressHint = body.addressHint ?? existing.addressHint;
      existing.allowedWifiSsids = body.allowedWifiSsids !== undefined ? body.allowedWifiSsids : existing.allowedWifiSsids;
      await this.geofence.save(existing);
      await this.log('geofence.updated', 'geofence_config', existing.id, actorId, body);
      return existing;
    }
    const config = await this.geofence.save(this.geofence.create({ ...body, radiusMeters: body.radiusMeters ?? 100 }));
    await this.log('geofence.created', 'geofence_config', config.id, actorId, body);
    return config;
  }

  async listGeofenceConfigs() {
    const configs = await this.geofence.find({ where: { isActive: true } });
    const zoneIds = configs.map((c) => c.zoneId);
    const zones = zoneIds.length ? await this.zones.findBy({ id: In(zoneIds) }) : [];
    return configs.map((c) => ({ ...c, zone: zones.find((z) => z.id === c.zoneId) ?? null }));
  }

  async deleteGeofence(actorId: string, zoneId: string) {
    const config = await this.geofence.findOneBy({ zoneId });
    if (!config) throw new NotFoundError('Geofence config not found');
    config.isActive = false;
    await this.geofence.save(config);
    await this.log('geofence.deleted', 'geofence_config', config.id, actorId, { zoneId });
    return { deleted: true, zoneId };
  }

  async checkIn(staffId: string, id: string, method = 'web', lat?: number, lng?: number, wifiSsid?: string) {
    const schedule = await this.requireOwnedSchedule(staffId, id);
    if (schedule.status === 'cancelled' || schedule.status === 'completed') {
      throw new ConflictError('Assignment is not active');
    }
    if (schedule.status === 'in_progress') {
      throw new ConflictError('Already checked in');
    }
    const existing = await this.attendance.findOneBy({ scheduleId: id });
    if (existing?.status === 'pending_manual') {
      throw new ConflictError('A manual check-in request is already pending for this assignment');
    }
    const shift = await this.requireShift(schedule.shiftId);
    const now = new Date();
    const shiftStart = new Date(`${schedule.workDate}T${shift.startTime}`);
    const checkinWindowMs = 45 * 60 * 1000;
    const checkinOpen = new Date(shiftStart.getTime() - checkinWindowMs);
    if (now < checkinOpen) {
      throw new ConflictError(`Chưa đến giờ check-in (shift starts at ${shift.startTime}, check-in opens 45 min before)`);
    }

    let checkedViaWifi = false;
    if (lat != null && lng != null && schedule.zoneId) {
      const gf = await this.geofence.findOneBy({ zoneId: schedule.zoneId, isActive: true });
      if (gf) {
        const gpsTolerance = 15;
        const effectiveRadius = gf.radiusMeters + gpsTolerance;
        const distance = haversineDistanceMeters(lat, lng, gf.latitude, gf.longitude);
        if (distance > effectiveRadius) {
          if (wifiSsid && gf.allowedWifiSsids?.length && gf.allowedWifiSsids.includes(wifiSsid)) {
            checkedViaWifi = true;
          } else {
            await this.log('attendance.check_in_failed_geofence', 'staff_schedule', id, staffId, {
              latitude: lat,
              longitude: lng,
              distance: Math.round(distance),
              allowedRadius: gf.radiusMeters,
              wifiSsid: wifiSsid ?? null,
            });
            const suggestion = wifiSsid
              ? `Bạn đang ở ngoài khu vực làm việc (${Math.round(distance)}m > ${gf.radiusMeters}m cho phép). WiFi không khớp. Bạn có thể yêu cầu check-in thủ công.`
              : `Bạn đang ở ngoài khu vực làm việc (${Math.round(distance)}m > ${gf.radiusMeters}m cho phép). Kết nối WiFi thư viện hoặc yêu cầu check-in thủ công.`;
            throw new BadRequestError(suggestion);
          }
        }
      }
    }

    if (existing?.checkInAt) throw new ConflictError('Already checked in');
    const status = now > new Date(`${schedule.workDate}T${shift.startTime}`) ? 'late' : 'on_time';
    const item = existing ?? this.attendance.create({ scheduleId: id, staffId, status, method });
    item.checkInAt = now;
    item.status = status;
    item.method = checkedViaWifi ? 'wifi' : method;
    await this.attendance.save(item);
    schedule.status = 'in_progress';
    await this.schedules.save(schedule);
    await this.log('attendance.checked_in', 'staff_attendance', item.id, staffId, { scheduleId: id, status, method: item.method });
    return { schedule, attendance: item };
  }

  async requestManualCheckIn(assignmentId: string, staffId: string, note: string) {
    const schedule = await this.requireOwnedSchedule(staffId, assignmentId);
    if (schedule.status === 'cancelled' || schedule.status === 'completed') {
      throw new ConflictError('Assignment is not active');
    }
    if (schedule.status === 'in_progress') {
      throw new ConflictError('Already checked in');
    }

    const existing = await this.attendance.findOneBy({ scheduleId: assignmentId });
    if (existing?.status === 'pending_manual') {
      throw new ConflictError('A manual check-in request is already pending for this assignment');
    }
    if (existing?.checkInAt) {
      throw new ConflictError('Already checked in');
    }

    const item = existing ?? this.attendance.create({ scheduleId: assignmentId, staffId, status: 'pending_manual', method: 'manual' });
    item.status = 'pending_manual';
    item.invalidatedReason = `manual_checkin_request: ${note}`;
    await this.attendance.save(item);
    await this.log('attendance.manual_checkin_requested', 'staff_attendance', item.id, staffId, { scheduleId: assignmentId, note });
    await publishEvent('attendance.manual_checkin_requested', { attendanceId: item.id, scheduleId: assignmentId, staffId, note });
    return item;
  }

  async approveManualCheckIn(adminId: string, attendanceId: string, checkInAt?: Date) {
    const att = await this.attendance.findOneBy({ id: attendanceId });
    if (!att) throw new NotFoundError('Attendance record not found');
    if (att.status !== 'pending_manual') throw new ConflictError('Attendance is not a pending manual check-in request');

    const schedule = await this.schedules.findOneBy({ id: att.scheduleId });
    att.status = 'completed';
    att.checkInAt = checkInAt ?? new Date();
    att.invalidatedReason = null;
    await this.attendance.save(att);

    if (schedule && schedule.status !== 'in_progress') {
      schedule.status = 'in_progress';
      await this.schedules.save(schedule);
    }

    await this.log('attendance.manual_checkin_approved', 'staff_attendance', attendanceId, adminId, { scheduleId: att.scheduleId, checkInAt: att.checkInAt });
    await publishEvent('attendance.manual_checkin_approved', { attendanceId, scheduleId: att.scheduleId, adminId, checkInAt: att.checkInAt });
    return att;
  }

  async rejectManualCheckIn(adminId: string, attendanceId: string, reason: string) {
    const att = await this.attendance.findOneBy({ id: attendanceId });
    if (!att) throw new NotFoundError('Attendance record not found');
    if (att.status !== 'pending_manual') throw new ConflictError('Attendance is not a pending manual check-in request');

    att.status = 'rejected_manual';
    att.invalidatedReason = `manual_checkin_rejected: ${reason}`;
    await this.attendance.save(att);
    await this.log('attendance.manual_checkin_rejected', 'staff_attendance', attendanceId, adminId, { reason });
    return att;
  }

  async listManualCheckInRequests(status?: string) {
    const where: any = {};
    if (status) {
      where.status = status;
    } else {
      where.status = 'pending_manual';
    }
    const items = await this.attendance.find({
      where,
      order: { createdAt: 'DESC' },
    });
    const staffIds = [...new Set(items.map((i) => i.staffId))];
    const scheduleIds = [...new Set(items.map((i) => i.scheduleId))];
    const staff = staffIds.length ? await this.users.listStaff(staffIds) : [];
    const schedules = scheduleIds.length ? await this.schedules.findBy({ id: In(scheduleIds) }) : [];
    return items.map((att) => ({
      ...att,
      staff: staff.find((s) => s.id === att.staffId) ?? null,
      assignment: schedules.find((s) => s.id === att.scheduleId) ?? null,
    }));
  }

  async auditLogs(filters: {
    page?: number;
    limit?: number;
    category?: string;
    action?: string;
    entityType?: string;
    actorId?: string;
    fromDate?: string;
    toDate?: string;
    search?: string;
  } = {}) {
    const qb = this.audit.createQueryBuilder('log');

    if (filters.category) {
      const catPrefixes: Record<string, string[]> = {
        assignment: ['assignment.'],
        attendance: ['attendance.'],
        config: ['zone.', 'shift.', 'template.'],
      };
      const prefixes = catPrefixes[filters.category];
      if (prefixes) {
        const conditions = prefixes.map((p, i) => `log.action LIKE :prefix${i}`);
        qb.andWhere(`(${conditions.join(' OR ')})`, Object.fromEntries(prefixes.map((p, i) => [`prefix${i}`, `${p}%`])));
      }
    }

    if (filters.action) qb.andWhere('log.action = :action', { action: filters.action });
    if (filters.entityType) qb.andWhere('log.entity_type = :entityType', { entityType: filters.entityType });
    if (filters.actorId) qb.andWhere('log.actor_id = :actorId', { actorId: filters.actorId });
    if (filters.fromDate) qb.andWhere('log.created_at >= :fromDate', { fromDate: `${filters.fromDate} 00:00:00` });
    if (filters.toDate) qb.andWhere('log.created_at <= :toDate', { toDate: `${filters.toDate} 23:59:59` });
    if (filters.search) {
      qb.andWhere('(log.actor_name ILIKE :search OR log.metadata::text ILIKE :search)', { search: `%${filters.search}%` });
    }

    const p = filters.page || 1;
    const l = Math.min(filters.limit || 50, 200);
    qb.orderBy('log.created_at', 'DESC');
    qb.skip((p - 1) * l).take(l);

    const [items, total] = await qb.getManyAndCount();

    const allStaffIds = new Set<string>();
    const allShiftIds = new Set<string>();
    const allZoneIds = new Set<string>();
    for (const item of items) {
      if (item.actorId) allStaffIds.add(item.actorId);
      const m = item.metadata as Record<string, unknown> | null;
      if (m) {
        if (typeof m.staffId === 'string') allStaffIds.add(m.staffId);
        if (typeof m.targetStaffId === 'string') allStaffIds.add(m.targetStaffId);
        if (typeof m.shiftId === 'string') allShiftIds.add(m.shiftId);
        if (typeof m.zoneId === 'string') allZoneIds.add(m.zoneId);
      }
    }

    const [staffList, shiftList, zoneList] = await Promise.all([
      allStaffIds.size ? this.users.listStaff([...allStaffIds]) : Promise.resolve([]),
      allShiftIds.size ? this.shifts.findBy({ id: In([...allShiftIds]) }) : Promise.resolve([]),
      allZoneIds.size ? this.zones.findBy({ id: In([...allZoneIds]) }) : Promise.resolve([]),
    ]);

    const staffMap = new Map(staffList.map((s) => [s.id, s.fullName || s.email]));
    const shiftMap = new Map(shiftList.map((s) => [s.id, s.name]));
    const zoneMap = new Map(zoneList.map((z) => [z.id, z.zoneName]));

    const enriched = items.map((item) => {
      const m = item.metadata ? { ...item.metadata } as Record<string, unknown> : null;
      if (m) {
        if (typeof m.staffId === 'string') m.staffName = staffMap.get(m.staffId) || m.staffId;
        if (typeof m.targetStaffId === 'string') m.targetStaffName = staffMap.get(m.targetStaffId) || m.targetStaffId;
        if (typeof m.shiftId === 'string') m.shiftName = shiftMap.get(m.shiftId) || m.shiftId;
        if (typeof m.zoneId === 'string') m.zoneName = zoneMap.get(m.zoneId) || m.zoneId;
      }
      return {
        ...item,
        metadata: m,
        actorName: item.actorName || (item.actorId ? staffMap.get(item.actorId) || null : null),
      };
    });

    return { items: enriched, total, page: p, limit: l, totalPages: Math.ceil(total / l) };
  }

  async auditStats(filters: { fromDate?: string; toDate?: string }) {
    const today = localDate(new Date());
    const weekStart = localDate(new Date(Date.now() - new Date().getDay() * 86400000));

    const buildQb = () => {
      const qb = this.audit.createQueryBuilder('log');
      if (filters.fromDate) qb.andWhere('log.created_at >= :fromDate', { fromDate: `${filters.fromDate} 00:00:00` });
      if (filters.toDate) qb.andWhere('log.created_at <= :toDate', { toDate: `${filters.toDate} 23:59:59` });
      return qb;
    };

    const todayQb = this.audit.createQueryBuilder('log')
      .where('log.created_at >= :today', { today: `${today} 00:00:00` });
    const weekQb = this.audit.createQueryBuilder('log')
      .where('log.created_at >= :weekStart', { weekStart: `${weekStart} 00:00:00` });

    const [totalToday, totalThisWeek, topActions, activityByStaff, activityByHour] = await Promise.all([
      todayQb.getCount(),
      weekQb.getCount(),
      buildQb().select('log.action', 'action').addSelect('COUNT(*)', 'count')
        .groupBy('log.action').orderBy('count', 'DESC').limit(10).getRawMany(),
      buildQb().select('COALESCE(log.actor_name, log.actor_id)', 'staffName').addSelect('COUNT(*)', 'count')
        .groupBy('COALESCE(log.actor_name, log.actor_id)').orderBy('count', 'DESC').limit(10).getRawMany(),
      buildQb().select("EXTRACT(HOUR FROM log.created_at)", 'hour').addSelect('COUNT(*)', 'count')
        .groupBy('hour').orderBy('hour', 'ASC').getRawMany(),
    ]);

    return { totalToday, totalThisWeek, topActions, activityByStaff, activityByHour };
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

  private async ensureNoDuplicateAssignment(staffId: string, shiftId: string, zoneId: string, workDate: string, exceptId?: string, force?: boolean) {
    const where: any = {
      staffId,
      shiftId,
      zoneId,
      workDate,
      status: Not(In(['cancelled', 'completed'])),
    };
    if (exceptId) where.id = Not(exceptId);
    const existing = await this.schedules.findOne({ where });
    if (existing) {
      if (force) return 'Staff is already assigned to this shift and zone';
      throw new ConflictError('Staff is already assigned to this shift and zone');
    }
    return undefined;
  }

  private async ensureFutureDate(workDate: string) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const minDate = localDate(yesterday);
    if (workDate < minDate) {
      throw new BadRequestError('Work date must be today or in the future');
    }
  }

  private async ensureNoZoneConflictOnSameDay(staffId: string, zoneId: string, workDate: string, exceptId?: string, force?: boolean) {
    const where: any = {
      staffId,
      workDate,
      status: Not(In(['cancelled'])),
    };
    if (exceptId) where.id = Not(exceptId);
    const existing = await this.schedules.findOne({ where });
    if (existing && existing.zoneId !== zoneId) {
      if (force) return 'Staff is already assigned to a different zone on this day';
      throw new ConflictError('Staff is already assigned to a different zone on this day');
    }
    return undefined;
  }

  private async ensureNoShiftTimeOverlap(staffId: string, shiftId: string, workDate: string, exceptId?: string, force?: boolean) {
    const newShift = await this.requireShift(shiftId);
    const newStart = newShift.startTime.slice(0, 5);
    const newEnd = newShift.endTime.slice(0, 5);

    const where: any = {
      staffId,
      workDate,
      status: Not(In(['cancelled'])),
    };
    if (exceptId) where.id = Not(exceptId);

    const existingAssignments = await this.schedules.find({ where });

    const shiftIds = [...new Set(existingAssignments.map(a => a.shiftId))];
    if (shiftIds.length === 0) return undefined;

    const existingShifts = await this.shifts.find({
      where: { id: In(shiftIds), isActive: true }
    });
    const shiftMap = new Map(existingShifts.map(s => [s.id, s]));

    for (const assignment of existingAssignments) {
      if (assignment.shiftId === shiftId) continue;
      const existingShift = shiftMap.get(assignment.shiftId);
      if (!existingShift) continue;
      const existStart = existingShift.startTime.slice(0, 5);
      const existEnd = existingShift.endTime.slice(0, 5);
      if (newStart < existEnd && newEnd > existStart) {
        const msg = `New shift time (${newStart}-${newEnd}) overlaps with existing shift "${existingShift.name}" (${existStart}-${existEnd}) on ${workDate}`;
        if (force) return msg;
        throw new ConflictError(msg);
      }
    }
    return undefined;
  }

  private async ensureNoOverstaffing(shiftId: string, zoneId: string, workDate: string, force?: boolean, manager?: import('typeorm').EntityManager) {
    const shift = await this.requireShift(shiftId);
    if (!shift.maxStaff) return undefined;
    const repo = manager ? manager.getRepository(StaffSchedule) : this.schedules;
    const count = await repo.count({
      where: { shiftId, zoneId, workDate, status: Not(In(['cancelled', 'completed'])) },
    });
    if (count >= shift.maxStaff) {
      const msg = `Shift is already at maximum capacity (${shift.maxStaff} staff)`;
      if (force) return msg;
      throw new ConflictError(msg);
    }
    return undefined;
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


  private async log(
    action: string, entityType: string, entityId: string | null,
    actorId: string | null, metadata: Record<string, unknown> | null | undefined,
    actorName?: string | null
  ) {
    const ctx = getAuditContext();
    await this.audit.save(this.audit.create({
      action,
      entityType,
      entityId,
      actorId: actorId || null,
      actorName: actorName || null,
      metadata: metadata ?? null,
      ipAddress: ctx?.ipAddress || null,
      userAgent: ctx?.userAgent || null,
      requestPath: ctx?.requestPath || null,
    }));
  }
}

export const scheduleService = new ScheduleService();
