import { Repository, In } from 'typeorm';
import { AppDataSource } from '../data-source';
import { ScheduleAuditLog, StaffShift, LibraryZone } from '../entities';
import { UserServiceClient } from '../clients/UserServiceClient';
import { localDate } from './scheduleDate';

type StaffClient = {
  listStaff(ids?: string[]): Promise<any[]>;
};

/**
 * AuditService — read-side reporting over the schedule audit trail.
 * Single responsibility: query/enrich ScheduleAuditLog rows (auditLogs) and
 * aggregate activity stats (auditStats).
 */
export class AuditService {
  private audit: Repository<ScheduleAuditLog>;
  private shifts: Repository<StaffShift>;
  private zones: Repository<LibraryZone>;
  private users: StaffClient;

  constructor(
    audit: Repository<ScheduleAuditLog> = AppDataSource.getRepository(ScheduleAuditLog),
    users: StaffClient = new UserServiceClient(),
    shifts: Repository<StaffShift> = AppDataSource.getRepository(StaffShift),
    zones: Repository<LibraryZone> = AppDataSource.getRepository(LibraryZone),
  ) {
    this.audit = audit;
    this.users = users;
    this.shifts = shifts;
    this.zones = zones;
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
}
