import { AppDataSource } from '../data-source';
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
import { UserServiceClient } from '../clients/UserServiceClient';
import { ZoneService } from './zoneService';
import { ShiftService } from './shiftService';
import { TemplateService } from './templateService';
import { PreferenceService } from './preferenceService';
import { AuditService } from './auditService';
import { GeofenceService } from './geofenceService';
import { AttendanceService } from './attendanceService';
import { AssignmentService } from './assignmentService';

/**
 * ScheduleService — public facade over the schedule domain services.
 *
 * Routes, internal handlers and existing tests depend on this single entry
 * point, so every public method keeps its original name and signature and
 * only delegates to the owning domain service:
 *
 *   - ZoneService / ShiftService / TemplateService / PreferenceService  (config CRUD)
 *   - AssignmentService  (assignments, bulk create, auto-scheduling)
 *   - AttendanceService  (check-in/out, manual check-in approval)
 *   - GeofenceService    (geofence config + check-in location verification)
 *   - AuditService       (audit trail queries)
 *
 * Repositories are declared first, in the original order, so the
 * `AppDataSource.getRepository(...)` call sequence observed by tests is
 * unchanged; every domain service receives them explicitly as arguments.
 */
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

  // Domain services — receive the repositories above explicitly so the
  // AppDataSource.getRepository() call order (relied on by tests) is unchanged.
  private zoneSvc = new ZoneService(this.zones, this.schedules, this.templates, this.audit);
  private shiftSvc = new ShiftService(this.shifts, this.schedules, this.templates, this.audit);
  private templateSvc = new TemplateService(this.users, this.templates, this.shifts, this.zones, this.audit);
  private preferenceSvc = new PreferenceService(this.preferences, this.shifts, this.zones, this.audit);
  private auditSvc = new AuditService(this.audit, this.users, this.shifts, this.zones);
  private geofenceSvc = new GeofenceService(this.geofence, this.zones, this.schedules, this.audit);
  private attendanceSvc = new AttendanceService(
    this.attendance, this.schedules, this.shifts, this.geofence, this.audit, this.users, this.geofenceSvc,
  );
  private assignmentSvc = new AssignmentService(
    this.schedules, this.shifts, this.zones, this.templates, this.attendance, this.preferences, this.audit, this.users,
  );

  async listStaff(ids?: string[]) {
    return this.users.listStaff(ids);
  }

  async health() {
    return { status: 'ok', service: 'schedule-service' };
  }

  async createZone(actorId: string, body: Partial<LibraryZone>) {
    return this.zoneSvc.createZone(actorId, body);
  }

  async listZones() {
    return this.zoneSvc.listZones();
  }

  async updateZone(actorId: string, id: string, body: Partial<LibraryZone>) {
    return this.zoneSvc.updateZone(actorId, id, body);
  }

  async deleteZone(actorId: string, id: string) {
    return this.zoneSvc.deleteZone(actorId, id);
  }

  async createShift(actorId: string, body: Partial<StaffShift>) {
    return this.shiftSvc.createShift(actorId, body);
  }

  async listShifts() {
    return this.shiftSvc.listShifts();
  }

  async updateShift(actorId: string, id: string, body: Partial<StaffShift>) {
    return this.shiftSvc.updateShift(actorId, id, body);
  }

  async deleteShift(actorId: string, id: string) {
    return this.shiftSvc.deleteShift(actorId, id);
  }

  async createTemplate(actorId: string, body: Partial<StaffScheduleTemplate>) {
    return this.templateSvc.createTemplate(actorId, body);
  }

  async listTemplates() {
    return this.templateSvc.listTemplates();
  }

  async updateTemplate(actorId: string, id: string, body: Partial<StaffScheduleTemplate>) {
    return this.templateSvc.updateTemplate(actorId, id, body);
  }

  async deleteTemplate(actorId: string, id: string) {
    return this.templateSvc.deleteTemplate(actorId, id);
  }

  async listPreferences(staffId?: string, page?: number, limit?: number) {
    return this.preferenceSvc.listPreferences(staffId, page, limit);
  }

  async createPreference(actorId: string, body: { staffId: string; shiftId: string; zoneId: string; priority?: number }) {
    return this.preferenceSvc.createPreference(actorId, body);
  }

  async deletePreference(actorId: string, id: string) {
    return this.preferenceSvc.deletePreference(actorId, id);
  }

  async getPreferencesForStaff(staffId: string) {
    return this.preferenceSvc.getPreferencesForStaff(staffId);
  }

  async getPreferenceById(id: string) {
    return this.preferenceSvc.getPreferenceById(id);
  }

  async generateFromTemplate(actorId: string, from: string, to: string) {
    return this.assignmentSvc.generateFromTemplate(actorId, from, to);
  }

  async listAssignments(filters: { from?: string; to?: string; staffId?: string; zoneId?: string; shiftId?: string; status?: string; page?: number; limit?: number }) {
    return this.assignmentSvc.listAssignments(filters);
  }

  async createAssignment(actorId: string, body: Partial<StaffSchedule>, force?: boolean) {
    return this.assignmentSvc.createAssignment(actorId, body, force);
  }

  async updateAssignment(actorId: string, id: string, body: Partial<StaffSchedule>, force?: boolean) {
    return this.assignmentSvc.updateAssignment(actorId, id, body, force);
  }

  async moveAssignment(actorId: string, id: string, body: Partial<StaffSchedule>) {
    return this.assignmentSvc.moveAssignment(actorId, id, body);
  }

  async deleteAssignment(actorId: string, id: string) {
    return this.assignmentSvc.deleteAssignment(actorId, id);
  }

  async deleteWeekAssignments(actorId: string, from: string, to: string, notify: boolean) {
    return this.assignmentSvc.deleteWeekAssignments(actorId, from, to, notify);
  }

  async listMine(staffId: string, from?: string, to?: string) {
    return this.assignmentSvc.listMine(staffId, from, to);
  }

  async confirmAssignment(staffId: string, id: string) {
    return this.assignmentSvc.confirmAssignment(staffId, id);
  }

  async adminConfirmAssignment(actorId: string, id: string) {
    return this.assignmentSvc.adminConfirmAssignment(actorId, id);
  }

  async adminFixAttendance(actorId: string, scheduleId: string, body: { checkInAt?: string; checkOutAt?: string; status?: string }) {
    return this.attendanceSvc.adminFixAttendance(actorId, scheduleId, body);
  }

  async checkOut(staffId: string, id: string) {
    return this.attendanceSvc.checkOut(staffId, id);
  }

  async autoCheckoutStaleAssignments() {
    return this.attendanceSvc.autoCheckoutStaleAssignments();
  }

  async createAssignmentsBulk(actorId: string, items: Array<{ staffId: string; shiftId: string; zoneId: string; workDate: string; note?: string | null; status?: string }>, force?: boolean) {
    return this.assignmentSvc.createAssignmentsBulk(actorId, items, force);
  }

  async autoSchedule(actorId: string, from: string, to: string) {
    return this.assignmentSvc.autoSchedule(actorId, from, to);
  }

  async setGeofence(actorId: string, body: { zoneId?: string | null; latitude: number; longitude: number; radiusMeters?: number; addressHint?: string | null; allowedWifiSsids?: string[] | null; isGlobal?: boolean }) {
    return this.geofenceSvc.setGeofence(actorId, body);
  }

  async listGeofenceConfigs() {
    return this.geofenceSvc.listGeofenceConfigs();
  }

  async deleteGeofence(actorId: string, zoneId: string) {
    return this.geofenceSvc.deleteGeofence(actorId, zoneId);
  }

  async getAssignmentGeofence(staffId: string, assignmentId: string) {
    return this.geofenceSvc.getAssignmentGeofence(staffId, assignmentId);
  }

  async checkIn(staffId: string, id: string, method = 'web', lat?: number, lng?: number) {
    return this.attendanceSvc.checkIn(staffId, id, method, lat, lng);
  }

  async requestManualCheckIn(assignmentId: string, staffId: string, note: string) {
    return this.attendanceSvc.requestManualCheckIn(assignmentId, staffId, note);
  }

  async approveManualCheckIn(
    adminId: string,
    attendanceId: string,
    checkInAtOrOptions?: Date | { checkInAt?: Date; lat?: number; lng?: number },
  ) {
    return this.attendanceSvc.approveManualCheckIn(adminId, attendanceId, checkInAtOrOptions);
  }

  async rejectManualCheckIn(adminId: string, attendanceId: string, reason: string) {
    return this.attendanceSvc.rejectManualCheckIn(adminId, attendanceId, reason);
  }

  async listManualCheckInRequests(status?: string) {
    return this.attendanceSvc.listManualCheckInRequests(status);
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
    return this.auditSvc.auditLogs(filters);
  }

  async auditStats(filters: { fromDate?: string; toDate?: string }) {
    return this.auditSvc.auditStats(filters);
  }
}

export const scheduleService = new ScheduleService();
