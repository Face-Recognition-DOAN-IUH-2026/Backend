import { Repository, Between, In, Not } from 'typeorm';
import { AppDataSource } from '../data-source';
import {
  LibraryZone,
  ScheduleAuditLog,
  StaffAttendance,
  StaffSchedule,
  StaffScheduleTemplate,
  StaffShift,
  StaffShiftPreference,
} from '../entities';
import { BadRequestError, ConflictError, NotFoundError } from '../errors';
import { UserServiceClient } from '../clients/UserServiceClient';
import { publishEvent } from '../utils/eventPublisher';
import { toUtcDateStr } from '../../../shared/utils/date';
import { localDate } from './scheduleDate';
import { writeAuditLog } from './scheduleAudit';
import { ensureScheduleTargets, requireShift, requireOwnedSchedule } from './scheduleGuards';

type StaffClient = {
  listStaff(ids?: string[]): Promise<any[]>;
  requireActiveStaff(staffId: string): Promise<unknown>;
};

/**
 * AssignmentService — assignment lifecycle + auto-scheduling.
 * Single responsibility: create/update/move/cancel StaffSchedule rows, apply
 * conflict rules (duplicate / zone / time-overlap / capacity) and run the
 * two-pass auto-scheduler (templates first, then scored gap filling).
 */
export class AssignmentService {
  private schedules: Repository<StaffSchedule>;
  private shifts: Repository<StaffShift>;
  private zones: Repository<LibraryZone>;
  private templates: Repository<StaffScheduleTemplate>;
  private attendance: Repository<StaffAttendance>;
  private preferences: Repository<StaffShiftPreference>;
  private audit: Repository<ScheduleAuditLog>;
  private users: StaffClient;

  constructor(
    schedules: Repository<StaffSchedule> = AppDataSource.getRepository(StaffSchedule),
    shifts: Repository<StaffShift> = AppDataSource.getRepository(StaffShift),
    zones: Repository<LibraryZone> = AppDataSource.getRepository(LibraryZone),
    templates: Repository<StaffScheduleTemplate> = AppDataSource.getRepository(StaffScheduleTemplate),
    attendance: Repository<StaffAttendance> = AppDataSource.getRepository(StaffAttendance),
    preferences: Repository<StaffShiftPreference> = AppDataSource.getRepository(StaffShiftPreference),
    audit: Repository<ScheduleAuditLog> = AppDataSource.getRepository(ScheduleAuditLog),
    users: StaffClient = new UserServiceClient(),
  ) {
    this.schedules = schedules;
    this.shifts = shifts;
    this.zones = zones;
    this.templates = templates;
    this.attendance = attendance;
    this.preferences = preferences;
    this.audit = audit;
    this.users = users;
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
    const filterActive = !filters.status;
    const enriched = await this.enrichAssignments(items, filterActive);
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
    await ensureScheduleTargets(this.users, this.shifts, this.zones, body.staffId!, body.shiftId!, body.zoneId!);
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

    await writeAuditLog(this.audit, force ? 'assignment.force_created' : 'assignment.created', 'staff_schedule', schedule.id, actorId, { ...body, force, warnings });

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
    await ensureScheduleTargets(this.users, this.shifts, this.zones, next.staffId, next.shiftId, next.zoneId);
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

    await writeAuditLog(this.audit, force ? 'assignment.force_updated' : 'assignment.updated', 'staff_schedule', id, actorId, { ...body, force, warnings });

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
    await writeAuditLog(this.audit, 'assignment.moved', 'staff_schedule', id, actorId, body);
    return moved;
  }

  async deleteAssignment(actorId: string, id: string) {
    const schedule = await this.schedules.findOneBy({ id });
    if (!schedule) throw new NotFoundError('Assignment not found');
    schedule.status = 'cancelled';
    await this.schedules.save(schedule);
    await writeAuditLog(this.audit, 'assignment.cancelled', 'staff_schedule', id, actorId, null);

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
    const today = toUtcDateStr();

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
      writeAuditLog(this.audit, 'assignment.bulk_cancelled', 'staff_schedule', s.id, actorId, { from, to, notify })
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
    const schedule = await requireOwnedSchedule(this.schedules, staffId, id);
    if (schedule.status === 'cancelled') throw new ConflictError('Assignment is cancelled');
    schedule.status = 'confirmed';
    await this.schedules.save(schedule);
    await writeAuditLog(this.audit, 'assignment.confirmed', 'staff_schedule', id, staffId, null);
    return schedule;
  }

  async adminConfirmAssignment(actorId: string, id: string) {
    const schedule = await this.schedules.findOneBy({ id });
    if (!schedule) throw new NotFoundError('Assignment not found');
    if (schedule.status === 'cancelled') throw new ConflictError('Assignment is cancelled');
    schedule.status = 'confirmed';
    schedule.assignedBy = actorId;
    await this.schedules.save(schedule);
    await writeAuditLog(this.audit, 'assignment.admin_confirmed', 'staff_schedule', id, actorId, null);
    return schedule;
  }

  async createAssignmentsBulk(actorId: string, items: Array<{ staffId: string; shiftId: string; zoneId: string; workDate: string; note?: string | null; status?: string }>, force?: boolean) {
    await Promise.all(items.map((item) =>
      Promise.all([
        ensureScheduleTargets(this.users, this.shifts, this.zones, item.staffId, item.shiftId, item.zoneId),
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
      await writeAuditLog(this.audit, entry.action, entry.entity, entry.entityId, entry.actorId, entry.data);
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
    await writeAuditLog(this.audit, 'auto_schedule.generated', 'staff_schedule', null, actorId, { from, to, proposed: proposed.length, skipped: skipped.length });
    return { proposed, skipped: skipped.length, total: proposed.length, actualFrom, actualTo: to, understaffed };
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
    const newShift = await requireShift(this.shifts, shiftId);
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
    const shift = await requireShift(this.shifts, shiftId);
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

  private async enrichAssignments(items: StaffSchedule[], filterActive = false) {
    if (!items.length) {
      return { items: [], total: 0 };
    }

    const shiftIds = [...new Set(items.map((item) => item.shiftId))];
    const zoneIds = [...new Set(items.map((item) => item.zoneId))];
    const staffIds = [...new Set(items.map((item) => item.staffId))];
    const [shifts, zones, attendance, staff] = await Promise.all([
      shiftIds.length ? this.shifts.findBy({ id: In(shiftIds) }) : [],
      zoneIds.length ? this.zones.findBy({ id: In(zoneIds) }) : [],
      items.length ? this.attendance.findBy({ scheduleId: In(items.map((item) => item.id)) }) : [],
      staffIds.length ? this.users.listStaff(staffIds) : [],
    ]);

    let targetItems = items;
    if (filterActive) {
      const activeShiftIds = new Set(shifts.filter((s) => s.isActive !== false).map((s) => s.id));
      const activeZoneIds = new Set(zones.filter((z) => z.isActive !== false).map((z) => z.id));
      targetItems = items.filter((item) => activeShiftIds.has(item.shiftId) && activeZoneIds.has(item.zoneId));
    }

    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const zoneMap = new Map(zones.map((z) => [z.id, z]));
    const attendanceMap = new Map(attendance.map((a) => [a.scheduleId, a]));
    const staffMap = new Map(staff.map((u) => [u.id, u]));

    return {
      items: targetItems.map((item) => ({
        ...item,
        shift: shiftMap.get(item.shiftId) ?? null,
        zone: zoneMap.get(item.zoneId) ?? null,
        attendance: attendanceMap.get(item.id) ?? null,
        staff: staffMap.get(item.staffId) ?? null,
      })),
      total: targetItems.length,
    };
  }
}
