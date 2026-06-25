import { Between, In, IsNull, Not } from 'typeorm';
import { AppDataSource } from '../data-source';
import {
  LibraryZone,
  ScheduleAuditLog,
  StaffAttendance,
  StaffAvailabilityRequest,
  StaffSchedule,
  StaffScheduleTemplate,
  StaffShift,
  StaffShiftPreference,
  ShiftBid,
  ShiftSwap,
  GeofenceConfig,
} from '../entities';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { UserServiceClient } from '../clients/UserServiceClient';
import { publishEvent } from '../utils/eventPublisher';

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
  private bids = AppDataSource.getRepository(ShiftBid);
  private swaps = AppDataSource.getRepository(ShiftSwap);
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

  async listPreferences(staffId?: string) {
    const where: any = { isActive: true };
    if (staffId) where.staffId = staffId;
    const items = await this.preferences.find({ where, order: { priority: 'ASC', createdAt: 'DESC' } });
    const shiftIds = [...new Set(items.map((i) => i.shiftId))];
    const zoneIds = [...new Set(items.map((i) => i.zoneId))];
    const [shifts, zones] = await Promise.all([
      shiftIds.length ? this.shifts.findBy({ id: In(shiftIds) }) : [],
      zoneIds.length ? this.zones.findBy({ id: In(zoneIds) }) : [],
    ]);
    return items.map((item) => ({
      ...item,
      shift: shifts.find((s) => s.id === item.shiftId) ?? null,
      zone: zones.find((z) => z.id === item.zoneId) ?? null,
    }));
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
    await this.ensureNoDuplicateAssignment(body.staffId!, body.shiftId!, body.zoneId!, body.workDate!);
    await this.ensureNoApprovedLeave(body.staffId!, body.workDate!);
    await this.ensureFutureDate(body.workDate!);
    await this.ensureNoZoneConflictOnSameDay(body.staffId!, body.zoneId!, body.workDate!);
    await this.ensureNoShiftTimeOverlap(body.staffId!, body.shiftId!, body.workDate!);
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

    // Publish schedule.changed event for automation-service
    const shift = await this.shifts.findOneBy({ id: body.shiftId! });
    publishEvent('schedule.changed', {
      staffId: body.staffId,
      shiftId: body.shiftId,
      shiftName: shift?.name || null,
      workDate: body.workDate,
      changeType: 'assigned',
    });

    return schedule;
  }

  async updateAssignment(actorId: string, id: string, body: Partial<StaffSchedule>) {
    const schedule = await this.schedules.findOneBy({ id });
    if (!schedule) throw new NotFoundError('Assignment not found');
    const next = { ...schedule, ...body };
    await this.ensureScheduleTargets(next.staffId, next.shiftId, next.zoneId);
    await this.ensureNoDuplicateAssignment(next.staffId, next.shiftId, next.zoneId, next.workDate, id);
    await this.ensureNoApprovedLeave(next.staffId, next.workDate);
    await this.ensureNoZoneConflictOnSameDay(next.staffId, next.zoneId, next.workDate, id);
    await this.ensureNoShiftTimeOverlap(next.staffId, next.shiftId, next.workDate, id);
    Object.assign(schedule, body);
    const saved = await this.schedules.save(schedule);
    await this.log('assignment.updated', 'staff_schedule', id, actorId, body);

    // Publish schedule.changed event for automation-service
    const updatedShift = await this.shifts.findOneBy({ id: next.shiftId! });
    publishEvent('schedule.changed', {
      staffId: next.staffId,
      shiftId: next.shiftId,
      shiftName: updatedShift?.name || null,
      workDate: next.workDate,
      changeType: 'updated',
    });

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

    // Publish schedule.changed event for automation-service
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

  async openShifts() {
    const today = localDate(new Date());
    const allAssignments = await this.schedules.find({ where: { workDate: Between(today, '2099-12-31'), status: Not(In(['cancelled', 'completed'])) } });
    const activeShifts = await this.shifts.findBy({ isActive: true });
    const activeZones = await this.zones.findBy({ isActive: true });
    const open: Array<{ shift: StaffShift; zone: LibraryZone; workDate: string }> = [];
    for (const shift of activeShifts) {
      for (const zone of activeZones) {
        const cursor = new Date(`${today}T00:00:00`);
        const end = new Date();
        end.setDate(end.getDate() + 13);
        while (cursor <= end) {
          const workDate = localDate(cursor);
          const count = allAssignments.filter((a) => a.workDate === workDate && a.shiftId === shift.id && a.zoneId === zone.id).length;
          for (let i = count; i < shift.minStaff; i++) {
            open.push({ shift, zone, workDate });
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }
    }
    return open;
  }

  async createBid(staffId: string, assignmentId: string, note?: string | null) {
    const assignment = await this.schedules.findOneBy({ id: assignmentId });
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.status !== 'scheduled') throw new ConflictError('Can only bid on scheduled/open assignments');
    const existing = await this.bids.findOneBy({ staffId, assignmentId, status: 'pending' });
    if (existing) throw new ConflictError('You already have a pending bid for this assignment');
    const bid = await this.bids.save(this.bids.create({ staffId, assignmentId, note: note ?? null, status: 'pending' }));
    await this.log('bid.created', 'shift_bid', bid.id, staffId, { assignmentId });
    return bid;
  }

  async listBids(staffId?: string, status?: string) {
    const where: any = {};
    if (staffId) where.staffId = staffId;
    if (status) where.status = status;
    const items = await this.bids.find({ where, order: { createdAt: 'DESC' } });
    const assignmentIds = [...new Set(items.map((b) => b.assignmentId))];
    const schedules = assignmentIds.length ? await this.schedules.findBy({ id: In(assignmentIds) }) : [];
    const staffIds = [...new Set(items.map((b) => b.staffId))];
    const staff = staffIds.length ? await this.users.listStaff(staffIds) : [];
    return items.map((bid) => {
      const assignment = schedules.find((s) => s.id === bid.assignmentId) ?? null;
      return { ...bid, assignment, staff: staff.find((s) => s.id === bid.staffId) ?? null };
    });
  }

  async cancelBid(staffId: string, id: string) {
    const bid = await this.bids.findOneBy({ id });
    if (!bid) throw new NotFoundError('Bid not found');
    if (bid.staffId !== staffId) throw new ForbiddenError('Cannot cancel another staff bid');
    if (bid.status !== 'pending') throw new ConflictError('Can only cancel pending bids');
    bid.status = 'cancelled';
    await this.bids.save(bid);
    await this.log('bid.cancelled', 'shift_bid', id, staffId, null);
    return bid;
  }

  async reviewBid(actorId: string, id: string, action: 'approved' | 'rejected') {
    const bid = await this.bids.findOneBy({ id });
    if (!bid) throw new NotFoundError('Bid not found');
    if (bid.status !== 'pending') throw new ConflictError('Bid is no longer pending');
    bid.status = action;
    bid.reviewedBy = actorId;
    bid.reviewedAt = new Date();
    await this.bids.save(bid);
    if (action === 'approved') {
      const assignment = await this.schedules.findOneBy({ id: bid.assignmentId });
      if (assignment) {
        assignment.staffId = bid.staffId;
        assignment.assignedBy = actorId;
        assignment.note = assignment.note ? `${assignment.note}\nAssigned via bid` : 'Assigned via bid';
        await this.schedules.save(assignment);
      }
    }
    await this.log(`bid.${action}`, 'shift_bid', id, actorId, { staffId: bid.staffId, assignmentId: bid.assignmentId });
    return bid;
  }

  async createSwap(requesterStaffId: string, body: { targetStaffId: string; requesterAssignmentId: string; targetAssignmentId?: string | null; reason?: string | null }) {
    const assignment = await this.requireOwnedSchedule(requesterStaffId, body.requesterAssignmentId);
    if (body.targetAssignmentId) {
      const target = await this.schedules.findOneBy({ id: body.targetAssignmentId });
      if (!target) throw new NotFoundError('Target assignment not found');
      if (target.staffId !== body.targetStaffId) throw new ForbiddenError('Target assignment does not belong to target staff');
    }
    const existing = await this.swaps.findOneBy({ requesterAssignmentId: body.requesterAssignmentId, status: 'pending' });
    if (existing) throw new ConflictError('You already have a pending swap for this assignment');
    const swap = await this.swaps.save(this.swaps.create({
      requesterStaffId,
      targetStaffId: body.targetStaffId,
      requesterAssignmentId: body.requesterAssignmentId,
      targetAssignmentId: body.targetAssignmentId ?? null,
      reason: body.reason ?? null,
      status: 'pending',
    }));
    await this.log('swap.created', 'shift_swap', swap.id, requesterStaffId, { targetStaffId: body.targetStaffId });
    return swap;
  }

  async listSwaps(staffId?: string, status?: string) {
    const where: any[] = [];
    if (staffId) {
      where.push({ requesterStaffId: staffId });
      where.push({ targetStaffId: staffId });
    }
    const finalWhere = where.length ? where : {};
    const items = await this.swaps.find({ where: finalWhere, order: { createdAt: 'DESC' } });
    const staffIds = [...new Set(items.flatMap((s) => [s.requesterStaffId, s.targetStaffId]))];
    const staff = staffIds.length ? await this.users.listStaff(staffIds) : [];
    const assignmentIds = [...new Set(items.flatMap((s) => [s.requesterAssignmentId, ...(s.targetAssignmentId ? [s.targetAssignmentId] : [])]))];
    const assignments = assignmentIds.length ? await this.enrichAssignments(await this.schedules.findBy({ id: In(assignmentIds) })) : { items: [], total: 0 };
    return items.map((swap) => ({
      ...swap,
      requester: staff.find((s) => s.id === swap.requesterStaffId) ?? null,
      target: staff.find((s) => s.id === swap.targetStaffId) ?? null,
      requesterAssignment: assignments.items.find((a) => a.id === swap.requesterAssignmentId) ?? null,
      targetAssignment: swap.targetAssignmentId ? (assignments.items.find((a) => a.id === swap.targetAssignmentId) ?? null) : null,
    }));
  }

  async respondSwap(staffId: string, id: string, action: 'accepted' | 'rejected', responseNote?: string | null) {
    const swap = await this.swaps.findOneBy({ id });
    if (!swap) throw new NotFoundError('Swap request not found');
    if (swap.targetStaffId !== staffId) throw new ForbiddenError('Cannot respond to swap request not addressed to you');
    if (swap.status !== 'pending') throw new ConflictError('Swap request is no longer pending');
    swap.status = action;
    swap.responseNote = responseNote ?? null;
    swap.reviewedAt = new Date();
    await this.swaps.save(swap);
    if (action === 'accepted') {
      const reqAsg = await this.schedules.findOneBy({ id: swap.requesterAssignmentId });
      if (!reqAsg) throw new NotFoundError('Requester assignment not found');
      if (swap.targetAssignmentId) {
        const tgtAsg = await this.schedules.findOneBy({ id: swap.targetAssignmentId });
        if (!tgtAsg) throw new NotFoundError('Target assignment not found');
        const reqStaffId = reqAsg.staffId;
        reqAsg.staffId = tgtAsg.staffId;
        tgtAsg.staffId = reqStaffId;
        await this.schedules.save([reqAsg, tgtAsg]);
      } else {
        reqAsg.staffId = swap.targetStaffId;
        await this.schedules.save(reqAsg);
      }
    }
    await this.log(`swap.${action}`, 'shift_swap', id, staffId, { responseNote });
    return swap;
  }

async autoSchedule(actorId: string, from: string, to: string) {
    const activeShifts = await this.shifts.findBy({ isActive: true });
    const activeZones = await this.zones.findBy({ isActive: true });
    const allStaff = await this.users.listStaff();
    const staff = allStaff.filter((s: any) => s.role === 'admin' || s.role === 'staff');
    const existingAssignments = await this.schedules.find({
      where: { workDate: Between(from, to), status: Not(In(['cancelled'])) },
    });
    const approvedLeaves = await this.availability.find({ where: { status: 'approved' } });
    const templates = await this.templates.findBy({ isActive: true });

    let preferences: StaffShiftPreference[] = [];
    try {
      preferences = await this.preferences.find({ where: { isActive: true } });
    } catch {
      // Table might not exist yet, continue without preferences
    }

    const proposed: Array<{ staffId: string; shiftId: string; zoneId: string; workDate: string; note: string }> = [];
    const skipped: string[] = [];
    const today = localDate(new Date());
    const cursor = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);

    const staffWorkload = new Map<string, number>();
    for (const s of staff) {
      const count = existingAssignments.filter((a) => a.staffId === s.id).length;
      staffWorkload.set(s.id, count);
    }

    const templatesByDayOfWeek = new Map<number, typeof templates>();
    for (const t of templates) {
      const list = templatesByDayOfWeek.get(t.dayOfWeek) || [];
      list.push(t);
      templatesByDayOfWeek.set(t.dayOfWeek, list);
    }

    const preferencesByShiftZone = new Map<string, string[]>();
    for (const p of preferences) {
      const key = `${p.shiftId}:${p.zoneId}`;
      const list = preferencesByShiftZone.get(key) || [];
      list.push(p.staffId);
      preferencesByShiftZone.set(key, list);
    }

    while (cursor <= end) {
      const workDate = localDate(cursor);
      if (workDate < today) { cursor.setDate(cursor.getDate() + 1); continue; }

      const dayOfWeek = cursor.getDay();
      const dayTemplates = templatesByDayOfWeek.get(dayOfWeek) || [];

      const dayStaff = [...staff].sort((a, b) => {
        const aTmpl = dayTemplates.some((t) => t.staffId === a.id);
        const bTmpl = dayTemplates.some((t) => t.staffId === b.id);
        if (aTmpl && !bTmpl) return -1;
        if (!aTmpl && bTmpl) return 1;
        const aHasPref = preferences.some((p) => p.staffId === a.id);
        const bHasPref = preferences.some((p) => p.staffId === b.id);
        if (aHasPref && !bHasPref) return -1;
        if (!aHasPref && bHasPref) return 1;
        const aLoad = staffWorkload.get(a.id) || 0;
        const bLoad = staffWorkload.get(b.id) || 0;
        return aLoad - bLoad;
      });

      for (const shift of activeShifts) {
        for (const zone of activeZones) {
          const existing = existingAssignments.filter((a) => a.workDate === workDate && a.shiftId === shift.id && a.zoneId === zone.id);
          const needed = (shift.minStaff || 1) - existing.length;
          if (needed <= 0) continue;

          const templateMatchFirst = dayTemplates
            .filter((t) => t.shiftId === shift.id && t.zoneId === zone.id)
            .map((t) => t.staffId);

          const prefKey = `${shift.id}:${zone.id}`;
          const prefMatchFirst = preferencesByShiftZone.get(prefKey) || [];

          let assigned = 0;
          for (const s of dayStaff) {
            if (assigned >= needed) break;
            if (proposed.some((p) => p.staffId === s.id && p.workDate === workDate)) continue;
            if (existing.some((e) => e.staffId === s.id)) continue;
            if (approvedLeaves.some((a) => a.staffId === s.id && workDate >= a.dateFrom && workDate <= a.dateTo)) {
              skipped.push(`leave:${s.id}:${workDate}`); continue;
            }

            const proposedCount = proposed.filter((p) => p.staffId === s.id).length + (staffWorkload.get(s.id) || 0);
            const maxShifts = 10;
            if (proposedCount >= maxShifts) { skipped.push(`max:${s.id}:${workDate}`); continue; }

            const isTemplate = templateMatchFirst.includes(s.id);
            const isPref = prefMatchFirst.includes(s.id);
            let note = 'Auto-scheduled';
            if (isTemplate) note = 'Auto-scheduled (template)';
            else if (isPref) note = 'Auto-scheduled (preference)';

            proposed.push({ staffId: s.id, shiftId: shift.id, zoneId: zone.id, workDate, note });
            staffWorkload.set(s.id, (staffWorkload.get(s.id) || 0) + 1);
            assigned++;
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    await this.log('auto_schedule.generated', 'staff_schedule', null, actorId, { from, to, proposed: proposed.length, skipped: skipped.length });
    return { proposed, skipped: skipped.length, total: proposed.length };
  }

  async setGeofence(actorId: string, body: { zoneId: string; latitude: number; longitude: number; radiusMeters?: number; addressHint?: string | null }) {
    const zone = await this.zones.findOneBy({ id: body.zoneId, isActive: true });
    if (!zone) throw new NotFoundError('Zone not found');
    const existing = await this.geofence.findOneBy({ zoneId: body.zoneId });
    if (existing) {
      existing.latitude = body.latitude;
      existing.longitude = body.longitude;
      existing.radiusMeters = body.radiusMeters ?? existing.radiusMeters;
      existing.addressHint = body.addressHint ?? existing.addressHint;
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

  async checkIn(staffId: string, id: string, method = 'web', lat?: number, lng?: number) {
    const schedule = await this.requireOwnedSchedule(staffId, id);
    if (schedule.status === 'cancelled' || schedule.status === 'completed') {
      throw new ConflictError('Assignment is not active');
    }
    if (lat != null && lng != null && schedule.zoneId) {
      const gf = await this.geofence.findOneBy({ zoneId: schedule.zoneId, isActive: true });
      if (gf) {
        const R = 6371e3;
        const φ1 = (lat * Math.PI) / 180;
        const φ2 = (gf.latitude * Math.PI) / 180;
        const Δφ = ((gf.latitude - lat) * Math.PI) / 180;
        const Δλ = ((gf.longitude - lng) * Math.PI) / 180;
        const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
        const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (distance > gf.radiusMeters) {
          throw new BadRequestError(`Bạn đang ở ngoài khu vực làm việc (${Math.round(distance)}m > ${gf.radiusMeters}m cho phép)`);
        }
      }
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

  private async ensureNoDuplicateAssignment(staffId: string, shiftId: string, zoneId: string, workDate: string, exceptId?: string) {
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
      throw new ConflictError('Staff is already assigned to this shift and zone');
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

  private async ensureFutureDate(workDate: string) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const minDate = localDate(yesterday);
    if (workDate < minDate) {
      throw new BadRequestError('Work date must be today or in the future');
    }
  }

  private async ensureNoZoneConflictOnSameDay(staffId: string, zoneId: string, workDate: string, exceptId?: string) {
    const where: any = {
      staffId,
      workDate,
      status: Not(In(['cancelled'])),
    };
    if (exceptId) where.id = Not(exceptId);
    const existing = await this.schedules.findOne({ where });
    if (existing && existing.zoneId !== zoneId) {
      throw new ConflictError('Staff is already assigned to a different zone on this day');
    }
  }

  private async ensureNoShiftTimeOverlap(staffId: string, shiftId: string, workDate: string, exceptId?: string) {
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

    // Batch load all shifts at once instead of per iteration
    const shiftIds = [...new Set(existingAssignments.map(a => a.shiftId))];
    if (shiftIds.length === 0) return;

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
        throw new ConflictError(
          `New shift time (${newStart}-${newEnd}) overlaps with existing shift "${existingShift.name}" (${existStart}-${existEnd}) on ${workDate}`,
        );
      }
    }
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
