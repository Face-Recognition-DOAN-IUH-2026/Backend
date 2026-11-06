import { Repository } from 'typeorm';
import { AppDataSource } from '../data-source';
import { RedisCacheService } from '../redis';
import {
  LibraryZone,
  StaffSchedule,
  StaffScheduleTemplate,
  ScheduleAuditLog,
} from '../entities';
import { NotFoundError } from '../errors';
import { writeAuditLog } from './scheduleAudit';
import { cancelAssignmentsForTarget } from './scheduleConfigCleanup';

/**
 * ZoneService — persistence + audit for library zones.
 * Single responsibility: CRUD LibraryZone with cache invalidation, audit logging,
 * and cascade deactivation of dependent assignments/templates on delete.
 */
export class ZoneService {
  private zones: Repository<LibraryZone>;
  private schedules: Repository<StaffSchedule>;
  private templates: Repository<StaffScheduleTemplate>;
  private audit: Repository<ScheduleAuditLog>;

  constructor(
    zones: Repository<LibraryZone> = AppDataSource.getRepository(LibraryZone),
    schedules: Repository<StaffSchedule> = AppDataSource.getRepository(StaffSchedule),
    templates: Repository<StaffScheduleTemplate> = AppDataSource.getRepository(StaffScheduleTemplate),
    audit: Repository<ScheduleAuditLog> = AppDataSource.getRepository(ScheduleAuditLog),
  ) {
    this.zones = zones;
    this.schedules = schedules;
    this.templates = templates;
    this.audit = audit;
  }

  async createZone(actorId: string, body: Partial<LibraryZone>) {
    const zone = await this.zones.save(this.zones.create(body));
    await RedisCacheService.del('schedule:zones:list');
    await writeAuditLog(this.audit, 'zone.created', 'library_zone', zone.id, actorId, body);
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
    await writeAuditLog(this.audit, 'zone.updated', 'library_zone', id, actorId, body);
    return saved;
  }

  async deleteZone(actorId: string, id: string) {
    const zone = await this.zones.findOneBy({ id });
    if (!zone) throw new NotFoundError('Zone not found');
    zone.isActive = false;
    await this.zones.save(zone);
    await RedisCacheService.del('schedule:zones:list');

    const cancelledCount = await cancelAssignmentsForTarget(
      this.schedules, this.audit, actorId, { zoneId: id }, 'zone.deactivated');

    const templates = await this.templates.findBy({ zoneId: id, isActive: true });
    for (const t of templates) { t.isActive = false; }
    if (templates.length) await this.templates.save(templates);

    await writeAuditLog(this.audit, 'zone.deactivated', 'library_zone', id, actorId, {
      cancelledAssignments: cancelledCount,
      deactivatedTemplates: templates.length,
    });
    return { deleted: true, id, cancelledAssignments: cancelledCount };
  }
}
