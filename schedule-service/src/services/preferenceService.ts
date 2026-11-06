import { Repository, In } from 'typeorm';
import { AppDataSource } from '../data-source';
import {
  StaffShiftPreference,
  StaffShift,
  LibraryZone,
  ScheduleAuditLog,
} from '../entities';
import { NotFoundError } from '../errors';
import { writeAuditLog } from './scheduleAudit';

/**
 * PreferenceService — persistence + audit for staff shift preferences.
 * Single responsibility: CRUD StaffShiftPreference with shift/zone enrichment.
 */
export class PreferenceService {
  private preferences: Repository<StaffShiftPreference>;
  private shifts: Repository<StaffShift>;
  private zones: Repository<LibraryZone>;
  private audit: Repository<ScheduleAuditLog>;

  constructor(
    preferences: Repository<StaffShiftPreference> = AppDataSource.getRepository(StaffShiftPreference),
    shifts: Repository<StaffShift> = AppDataSource.getRepository(StaffShift),
    zones: Repository<LibraryZone> = AppDataSource.getRepository(LibraryZone),
    audit: Repository<ScheduleAuditLog> = AppDataSource.getRepository(ScheduleAuditLog),
  ) {
    this.preferences = preferences;
    this.shifts = shifts;
    this.zones = zones;
    this.audit = audit;
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
      await writeAuditLog(this.audit, 'preference.updated', 'staff_shift_preference', existing.id, actorId, body);
      return existing;
    }
    const pref = await this.preferences.save(this.preferences.create({ ...body, priority: body.priority ?? 1 }));
    await writeAuditLog(this.audit, 'preference.created', 'staff_shift_preference', pref.id, actorId, body);
    return pref;
  }

  async deletePreference(actorId: string, id: string) {
    const pref = await this.preferences.findOneBy({ id });
    if (!pref) throw new NotFoundError('Preference not found');
    pref.isActive = false;
    await this.preferences.save(pref);
    await writeAuditLog(this.audit, 'preference.deactivated', 'staff_shift_preference', id, actorId, null);
    return { deleted: true, id };
  }

  async getPreferencesForStaff(staffId: string) {
    return this.preferences.find({ where: { staffId, isActive: true }, order: { priority: 'ASC' } });
  }

  async getPreferenceById(id: string) {
    return this.preferences.findOneBy({ id });
  }
}
