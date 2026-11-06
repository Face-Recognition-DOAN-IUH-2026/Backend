import { Repository, In } from 'typeorm';
import { AppDataSource } from '../data-source';
import {
  GeofenceConfig,
  ScheduleAuditLog,
  StaffAttendance,
  StaffSchedule,
  StaffShift,
} from '../entities';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { publishEvent } from '../utils/eventPublisher';
import { UserServiceClient } from '../clients/UserServiceClient';
import { localDate } from './scheduleDate';
import { writeAuditLog } from './scheduleAudit';
import { requireOwnedSchedule, requireShift } from './scheduleGuards';
import { GeofenceService, CheckInLocationVerification } from './geofenceService';

type StaffClient = {
  listStaff(ids?: string[]): Promise<any[]>;
};

type GeofenceVerifier = {
  verifyCheckInGeofence(
    schedule: StaffSchedule,
    staffId: string,
    input: { lat?: number; lng?: number; method: string },
  ): Promise<CheckInLocationVerification>;
};

/**
 * AttendanceService — check-in/out lifecycle and manual check-in approval.
 * Single responsibility: manage StaffAttendance rows and the matching
 * StaffSchedule status transitions, with geofence verified server-side.
 */
export class AttendanceService {
  private attendance: Repository<StaffAttendance>;
  private schedules: Repository<StaffSchedule>;
  private shifts: Repository<StaffShift>;
  private geofence: Repository<GeofenceConfig>;
  private audit: Repository<ScheduleAuditLog>;
  private users: StaffClient;
  private geofenceSvc: GeofenceVerifier;

  constructor(
    attendance: Repository<StaffAttendance> = AppDataSource.getRepository(StaffAttendance),
    schedules: Repository<StaffSchedule> = AppDataSource.getRepository(StaffSchedule),
    shifts: Repository<StaffShift> = AppDataSource.getRepository(StaffShift),
    geofence: Repository<GeofenceConfig> = AppDataSource.getRepository(GeofenceConfig),
    audit: Repository<ScheduleAuditLog> = AppDataSource.getRepository(ScheduleAuditLog),
    users: StaffClient = new UserServiceClient(),
    geofenceSvc: GeofenceVerifier = new GeofenceService(),
  ) {
    this.attendance = attendance;
    this.schedules = schedules;
    this.shifts = shifts;
    this.geofence = geofence;
    this.audit = audit;
    this.users = users;
    this.geofenceSvc = geofenceSvc;
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
    await writeAuditLog(this.audit, 'attendance.admin_fixed', 'staff_attendance', att.id, actorId, {
      scheduleId,
      changes: body,
    });
    return att;
  }

  async checkOut(staffId: string, id: string) {
    const schedule = await requireOwnedSchedule(this.schedules, staffId, id);
    const item = await this.attendance.findOneBy({ scheduleId: id });
    if (!item?.checkInAt) throw new ConflictError('Cannot check out before check in');
    if (item.checkOutAt) throw new ConflictError('Already checked out');
    const shift = await requireShift(this.shifts, schedule.shiftId);
    const now = new Date();
    const status = now < new Date(`${schedule.workDate}T${shift.endTime}`) ? 'left_early' : 'completed';
    item.checkOutAt = now;
    item.status = status;
    await this.attendance.save(item);
    schedule.status = 'completed';
    await this.schedules.save(schedule);
    await writeAuditLog(this.audit, 'attendance.checked_out', 'staff_attendance', item.id, staffId, { scheduleId: id, status });
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
        const shift = await requireShift(this.shifts, asg.shiftId);
        const shiftEnd = new Date(`${asg.workDate}T${shift.endTime}`);
        att.checkOutAt = shiftEnd;
        att.status = 'auto_checkout';
        await this.attendance.save(att);
        asg.status = 'completed';
        await this.schedules.save(asg);
        await writeAuditLog(this.audit, 'attendance.auto_checkout', 'staff_attendance', att.id, null, {
          scheduleId: asg.id,
          reason: 'shift ended without checkout',
        });
        checkedOut++;
      }
    }
    return { checkedOut };
  }

  async checkIn(staffId: string, id: string, method = 'web', lat?: number, lng?: number) {
    const schedule = await requireOwnedSchedule(this.schedules, staffId, id);
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
    const shift = await requireShift(this.shifts, schedule.shiftId);
    const now = new Date();
    const shiftStart = new Date(`${schedule.workDate}T${shift.startTime}`);
    const checkinWindowMs = 45 * 60 * 1000;
    const checkinOpen = new Date(shiftStart.getTime() - checkinWindowMs);
    if (now < checkinOpen) {
      throw new ConflictError(`Chưa đến giờ check-in (shift starts at ${shift.startTime}, check-in opens 45 min before)`);
    }

    // Geofence là điều kiện quyết định duy nhất: vị trí thiết bị phải nằm trong tâm + bán kính cho phép.
    const location = await this.geofenceSvc.verifyCheckInGeofence(schedule, staffId, { lat, lng, method });

    if (existing?.checkInAt) throw new ConflictError('Already checked in');
    const status = now > new Date(`${schedule.workDate}T${shift.startTime}`) ? 'late' : 'on_time';
    const item = existing ?? this.attendance.create({ scheduleId: id, staffId, status, method });
    item.checkInAt = now;
    item.status = status;
    item.method = location.method;
    await this.attendance.save(item);
    schedule.status = 'in_progress';
    await this.schedules.save(schedule);
    await writeAuditLog(this.audit, 'attendance.checked_in', 'staff_attendance', item.id, staffId, {
      scheduleId: id,
      status,
      method: item.method,
      locationVerified: location.verified,
      distanceMeters: location.distanceMeters,
      radiusMeters: location.radiusMeters,
    });
    return {
      schedule,
      attendance: item,
      location: {
        verified: location.verified,
        method: location.method,
        distanceMeters: location.distanceMeters,
        radiusMeters: location.radiusMeters,
        zoneId: location.zoneId,
        reason: location.reason,
      },
    };
  }

  async requestManualCheckIn(assignmentId: string, staffId: string, note: string) {
    const schedule = await requireOwnedSchedule(this.schedules, staffId, assignmentId);
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
    await writeAuditLog(this.audit, 'attendance.manual_checkin_requested', 'staff_attendance', item.id, staffId, { scheduleId: assignmentId, note });
    await publishEvent('attendance.manual_checkin_requested', { attendanceId: item.id, scheduleId: assignmentId, staffId, note });
    return item;
  }

  async approveManualCheckIn(
    adminId: string,
    attendanceId: string,
    checkInAtOrOptions?: Date | { checkInAt?: Date; lat?: number; lng?: number },
  ) {
    const att = await this.attendance.findOneBy({ id: attendanceId });
    if (!att) throw new NotFoundError('Attendance record not found');
    if (att.status !== 'pending_manual') throw new ConflictError('Attendance is not a pending manual check-in request');

    // D5: self-approval is forbidden — a staff member cannot approve their own
    // manual check-in request, regardless of role or geofence.
    if (adminId === att.staffId) {
      throw new ForbiddenError('SELF_APPROVAL_FORBIDDEN');
    }

    const schedule = await this.schedules.findOneBy({ id: att.scheduleId });

    let checkInAt: Date | undefined;
    let lat: number | undefined;
    let lng: number | undefined;
    if (checkInAtOrOptions instanceof Date) {
      checkInAt = checkInAtOrOptions;
    } else if (checkInAtOrOptions) {
      checkInAt = checkInAtOrOptions.checkInAt;
      lat = checkInAtOrOptions.lat;
      lng = checkInAtOrOptions.lng;
    }

    // Geofence is enforced server-side: never trust raw request coordinates alone.
    // If the assigned zone has an active geofence, the check-in location must be
    // provided and verified against it before approval.
    if (schedule?.zoneId) {
      const geofence = await this.geofence.findOneBy({ zoneId: schedule.zoneId, isActive: true });
      if (geofence) {
        if (lat === undefined || lng === undefined) {
          throw new BadRequestError(
            'Thiếu toạ độ GPS cho việc duyệt check-in thủ công. Vui lòng cung cấp vị trí thiết bị.',
          );
        }
        await this.geofenceSvc.verifyCheckInGeofence(schedule, adminId, { lat, lng, method: 'manual' });
      }
    }

    att.status = 'completed';
    att.checkInAt = checkInAt ?? new Date();
    att.invalidatedReason = null;
    await this.attendance.save(att);

    if (schedule && schedule.status !== 'in_progress') {
      schedule.status = 'in_progress';
      await this.schedules.save(schedule);
    }

    await writeAuditLog(this.audit, 'attendance.manual_checkin_approved', 'staff_attendance', attendanceId, adminId, { scheduleId: att.scheduleId, checkInAt: att.checkInAt });
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
    await writeAuditLog(this.audit, 'attendance.manual_checkin_rejected', 'staff_attendance', attendanceId, adminId, { reason });
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
}
