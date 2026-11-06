import { Repository } from 'typeorm';
import { AppDataSource } from '../data-source';
import {
  StaffScheduleTemplate,
  StaffShift,
  LibraryZone,
  ScheduleAuditLog,
} from '../entities';
import { NotFoundError, BadRequestError } from '../errors';
import { writeAuditLog } from './scheduleAudit';
import { ensureScheduleTargets as ensureTargets } from './scheduleGuards';

type UserClient = {
  requireActiveStaff(staffId: string): Promise<unknown>;
};

/**
 * TemplateService — persistence + audit for staff schedule templates.
 * Single responsibility: CRUD StaffScheduleTemplate with target validation and audit logging.
 */
export class TemplateService {
  private templates: Repository<StaffScheduleTemplate>;
  private shifts: Repository<StaffShift>;
  private zones: Repository<LibraryZone>;
  private audit: Repository<ScheduleAuditLog>;
  private users: UserClient;

  constructor(
    users: UserClient,
    templates: Repository<StaffScheduleTemplate> = AppDataSource.getRepository(StaffScheduleTemplate),
    shifts: Repository<StaffShift> = AppDataSource.getRepository(StaffShift),
    zones: Repository<LibraryZone> = AppDataSource.getRepository(LibraryZone),
    audit: Repository<ScheduleAuditLog> = AppDataSource.getRepository(ScheduleAuditLog),
  ) {
    this.templates = templates;
    this.shifts = shifts;
    this.zones = zones;
    this.audit = audit;
    this.users = users;
  }

  private async ensureScheduleTargets(staffId: string, shiftId: string, zoneId: string) {
    return ensureTargets(this.users, this.shifts, this.zones, staffId, shiftId, zoneId);
  }

  async createTemplate(actorId: string, body: Partial<StaffScheduleTemplate>) {
    await this.ensureScheduleTargets(body.staffId!, body.shiftId!, body.zoneId!);
    const template = await this.templates.save(this.templates.create(body));
    await writeAuditLog(this.audit, 'template.created', 'staff_schedule_template', template.id, actorId, body);
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
    await writeAuditLog(this.audit, 'template.updated', 'staff_schedule_template', id, actorId, body);
    return saved;
  }

  async deleteTemplate(actorId: string, id: string) {
    const template = await this.templates.findOneBy({ id });
    if (!template) throw new NotFoundError('Template not found');
    template.isActive = false;
    await this.templates.save(template);
    await writeAuditLog(this.audit, 'template.deactivated', 'staff_schedule_template', id, actorId, null);
    return { deleted: true, id };
  }
}
