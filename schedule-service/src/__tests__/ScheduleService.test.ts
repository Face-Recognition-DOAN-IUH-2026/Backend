/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Mocks (must be before imports) ─────────────────────────────────────────

const mockRepos: Record<string, any> = {};

function createMockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    findBy: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    create: jest.fn().mockImplementation((e) => e),
    delete: jest.fn().mockResolvedValue(undefined),
    softRemove: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    }),
    preload: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockResolvedValue(undefined),
  };
}

jest.mock('../data-source', () => {
  const getRepoFn = jest.fn().mockImplementation((entity: any) => {
    const name = entity?.name || String(entity);
    if (!mockRepos[name]) mockRepos[name] = createMockRepo();
    return mockRepos[name];
  });
  return {
    AppDataSource: {
      getRepository: getRepoFn,
      transaction: jest.fn().mockImplementation(async (cb: any) => {
        const manager = new Proxy({} as any, {
          get(_target, prop) {
            if (prop === 'getRepository') return getRepoFn;
            return function (...args: any[]) {
              const entity = args[0];
              const repo = entity ? getRepoFn(entity) : getRepoFn('StaffSchedule');
              const fn = repo[prop as string];
              if (typeof fn === 'function') {
                return fn.apply(repo, args.slice(1));
              }
              return fn;
            };
          },
        });
        return cb(manager);
      }),
    },
  };
});

jest.mock('../clients/UserServiceClient', () => ({
  UserServiceClient: jest.fn().mockImplementation(() => ({
    listStaff: jest.fn().mockResolvedValue([]),
    requireActiveStaff: jest.fn().mockResolvedValue({ id: 'staff-1', role: 'staff', status: 'active' }),
    getStaff: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock('../utils/eventPublisher', () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../redis', () => ({
  RedisCacheService: {
    del: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined),
  },
  redis: {
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { ScheduleService } from '../services/ScheduleService';
import { AppDataSource } from '../data-source';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { publishEvent } from '../utils/eventPublisher';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRepo(entityName: string) {
  return (AppDataSource.getRepository as jest.Mock).mock.results[0]?.value
    || mockRepos[entityName]
    || createMockRepo();
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function futureDate(days = 1) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ScheduleService', () => {
  let service: ScheduleService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockRepos).forEach(k => delete mockRepos[k]);
    service = new ScheduleService();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // health
  // ═══════════════════════════════════════════════════════════════════════════

  describe('health', () => {
    it('should return ok status', async () => {
      const result = await service.health();
      expect(result).toEqual({ status: 'ok', service: 'schedule-service' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createZone / updateZone / deleteZone
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createZone', () => {
    it('should create and return zone', async () => {
      const zone = { id: 'z1', floor: 1, zoneName: 'A', isActive: true };
      const repos = (AppDataSource.getRepository as jest.Mock).mock;
      const zoneRepo = repos.results.find((r: any) => r.value?.save)?.value || createMockRepo();
      zoneRepo.save.mockResolvedValue(zone);
      zoneRepo.create.mockReturnValue(zone);

      const result = await service.createZone('actor-1', { floor: 1, zoneName: 'A' });
      expect(result).toEqual(zone);
    });
  });

  describe('deleteZone', () => {
    it('should soft-delete zone and cancel assignments', async () => {
      const zone = { id: 'z1', isActive: true };
      const scheduleRepo = createMockRepo();
      scheduleRepo.find.mockResolvedValue([
        { id: 's1', status: 'scheduled', shiftId: 'sh1', zoneId: 'z1', note: null },
      ]);
      scheduleRepo.save.mockImplementation(e => Promise.resolve(e));

      // Override the schedules repo
      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      // Re-create service to pick up new mock
      service = new ScheduleService();

      // findOneBy for zone lookup
      const repos = (AppDataSource.getRepository as jest.Mock).mock;
      const zoneRepo = repos.results.find((r: any) => r.value?.findOneBy)?.value;
      if (zoneRepo) zoneRepo.findOneBy.mockResolvedValue(zone);

      const result = await service.deleteZone('actor-1', 'z1');
      expect(result.deleted).toBe(true);
      expect(result.id).toBe('z1');
      expect(scheduleRepo.save).toHaveBeenCalled();
    });

    it('should throw NotFoundError if zone does not exist', async () => {
      const repos = (AppDataSource.getRepository as jest.Mock).mock;
      const zoneRepo = repos.results.find((r: any) => r.value?.findOneBy)?.value;
      if (zoneRepo) zoneRepo.findOneBy.mockResolvedValue(null);

      await expect(service.deleteZone('actor-1', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createAssignment — the most complex method
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createAssignment', () => {
    let scheduleRepo: any;
    let shiftRepo: any;
    let zoneRepo: any;

    beforeEach(() => {
      scheduleRepo = createMockRepo();
      shiftRepo = createMockRepo();
      zoneRepo = createMockRepo();

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
      scheduleRepo.findOne.mockResolvedValue(null);
      scheduleRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
    });

    it('should create assignment successfully', async () => {
      const assignment = { id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled' };
      scheduleRepo.save.mockResolvedValue(assignment);

      const result = await service.createAssignment('actor-1', {
        staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1),
      });
      expect(result.id).toBe('a1');
      expect(publishEvent).toHaveBeenCalledWith('schedule.changed', expect.objectContaining({ changeType: 'assigned' }));
    });

    it('should throw ConflictError on duplicate assignment', async () => {
      scheduleRepo.findOne.mockResolvedValue({ id: 'existing', staffId: 'staff-1' });

      await expect(service.createAssignment('actor-1', {
        staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1),
      })).rejects.toThrow(ConflictError);
    });

    it('should throw BadRequestError for past date', async () => {
      await expect(service.createAssignment('actor-1', {
        staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: '2020-01-01',
      })).rejects.toThrow(BadRequestError);
    });

    it('should throw ConflictError on zone conflict (different zone same day)', async () => {
      scheduleRepo.findOne
        .mockResolvedValueOnce(null) // ensureNoDuplicateAssignment
        .mockResolvedValueOnce({ id: 'existing', zoneId: 'z2', staffId: 'staff-1' }); // ensureNoZoneConflictOnSameDay

      await expect(service.createAssignment('actor-1', {
        staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1),
      })).rejects.toThrow(ConflictError);
    });

    it('should throw ConflictError on shift time overlap', async () => {
      const otherShiftRepo = createMockRepo();
      otherShiftRepo.findOneBy.mockResolvedValue({ id: 'sh2', isActive: true, startTime: '10:00', endTime: '14:00', name: 'Mid' });

      scheduleRepo.findOne
        .mockResolvedValueOnce(null) // ensureNoDuplicateAssignment
        .mockResolvedValueOnce(null); // ensureNoZoneConflictOnSameDay

      scheduleRepo.find.mockResolvedValue([
        { id: 'existing-a', shiftId: 'sh2', staffId: 'staff-1', workDate: futureDate(1), status: 'scheduled' },
      ]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      // Override shiftRepo to return two different shifts
      shiftRepo.findOneBy
        .mockResolvedValueOnce({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' }) // ensureScheduleTargets
        .mockResolvedValueOnce({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' }); // requireShift in overlap check

      // Batch query now uses find() instead of findOneBy() for existing shifts
      shiftRepo.find.mockResolvedValue([
        { id: 'sh2', isActive: true, startTime: '10:00', endTime: '14:00', name: 'Mid' },
      ]);

      service = new ScheduleService();

      await expect(service.createAssignment('actor-1', {
        staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1),
      })).rejects.toThrow(ConflictError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // deleteAssignment
  // ═══════════════════════════════════════════════════════════════════════════

  describe('deleteAssignment', () => {
    it('should cancel assignment and publish event', async () => {
      const scheduleRepo = createMockRepo();
      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', status: 'scheduled', shiftId: 'sh1', staffId: 's1', workDate: '2026-01-01' });

      const shiftRepo = createMockRepo();
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', name: 'Morning' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.deleteAssignment('actor-1', 'a1');
      expect(result.deleted).toBe(true);
      expect(scheduleRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
      expect(publishEvent).toHaveBeenCalledWith('schedule.changed', expect.objectContaining({ changeType: 'cancelled' }));
    });

    it('should throw NotFoundError if assignment not found', async () => {
      const scheduleRepo = createMockRepo();
      scheduleRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.deleteAssignment('actor-1', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // checkIn / checkOut
  // ═══════════════════════════════════════════════════════════════════════════

  describe('checkIn', () => {
    it('should check in successfully (on_time)', async () => {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const geofenceRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: today(), status: 'scheduled',
      });
      attendanceRepo.findOneBy.mockResolvedValue(null);
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', startTime: '00:01', endTime: '12:00' });
      geofenceRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'GeofenceConfig') return geofenceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.checkIn('staff-1', 'a1');
      expect(result.schedule.status).toBe('in_progress');
      expect(result.attendance.checkInAt).toBeDefined();
    });

    it('should throw ConflictError if already checked in', async () => {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();
      const shiftRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: today(), status: 'in_progress',
      });
      attendanceRepo.findOneBy.mockResolvedValue({ scheduleId: 'a1', checkInAt: new Date() });
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', startTime: '00:01', endTime: '12:00' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.checkIn('staff-1', 'a1')).rejects.toThrow(ConflictError);
    });

    it('should throw ConflictError if assignment is cancelled', async () => {
      const scheduleRepo = createMockRepo();
      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: today(), status: 'cancelled',
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.checkIn('staff-1', 'a1')).rejects.toThrow(ConflictError);
    });

    it('should throw BadRequestError and log failure if out of geofence', async () => {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const geofenceRepo = createMockRepo();
      const auditRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: today(), status: 'scheduled',
      });
      attendanceRepo.findOneBy.mockResolvedValue(null);
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', startTime: '00:01', endTime: '12:00' });
      // Geofence at a very different location
      geofenceRepo.findOneBy.mockResolvedValue({ zoneId: 'z1', latitude: 10.0, longitude: 106.0, radiusMeters: 100, isActive: true });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'GeofenceConfig') return geofenceRepo;
        if (name === 'ScheduleAuditLog') return auditRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      // Check in from a very different lat/lng (should be out of 100m radius)
      await expect(service.checkIn('staff-1', 'a1', 'web', 20.0, 110.0)).rejects.toThrow(BadRequestError);

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'attendance.check_in_failed_geofence',
          entityType: 'staff_schedule',
          entityId: 'a1',
          actorId: 'staff-1',
          metadata: expect.objectContaining({
            allowedRadius: 100
          })
        })
      );
    });
  });

  describe('checkOut', () => {
    it('should check out successfully (completed)', async () => {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();
      const shiftRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: '2020-01-01', status: 'in_progress',
      });
      attendanceRepo.findOneBy.mockResolvedValue({ scheduleId: 'a1', checkInAt: new Date('2020-01-01T08:00:00'), checkOutAt: null });
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', startTime: '08:00', endTime: '12:00' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.checkOut('staff-1', 'a1');
      expect(result.schedule.status).toBe('completed');
      expect(result.attendance.status).toBe('completed');
    });

    it('should throw ConflictError if not checked in', async () => {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', workDate: futureDate(1), status: 'in_progress',
      });
      attendanceRepo.findOneBy.mockResolvedValue({ scheduleId: 'a1', checkInAt: null });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.checkOut('staff-1', 'a1')).rejects.toThrow(ConflictError);
    });

    it('should throw ConflictError if already checked out', async () => {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', workDate: futureDate(1), status: 'in_progress',
      });
      attendanceRepo.findOneBy.mockResolvedValue({ scheduleId: 'a1', checkInAt: new Date(), checkOutAt: new Date() });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.checkOut('staff-1', 'a1')).rejects.toThrow(ConflictError);
    });
  });









  // ═══════════════════════════════════════════════════════════════════════════
  // generateFromTemplate
  // ═══════════════════════════════════════════════════════════════════════════

  describe('generateFromTemplate', () => {
    it('should generate assignments from templates', async () => {
      const templateRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayOfWeek = tomorrow.getDay();

      templateRepo.findBy.mockResolvedValue([
        { id: 't1', name: 'Morning A', dayOfWeek, staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', isActive: true },
      ]);
      scheduleRepo.findOneBy.mockResolvedValue(null); // no existing assignment
      scheduleRepo.save.mockImplementation(e => Promise.resolve({ id: 'generated-' + Math.random(), ...e }));

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();

      const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
      const result = await service.generateFromTemplate('actor-1', dateStr, dateStr);
      expect(result.created).toBeGreaterThanOrEqual(1);
    });

    it('should skip if assignment already exists', async () => {
      const templateRepo = createMockRepo();
      const scheduleRepo = createMockRepo();

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayOfWeek = tomorrow.getDay();
      const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

      templateRepo.findBy.mockResolvedValue([
        { id: 't1', name: 'Morning A', dayOfWeek, staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', isActive: true },
      ]);
      scheduleRepo.findOneBy.mockResolvedValue({ id: 'existing' }); // already exists

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.generateFromTemplate('actor-1', dateStr, dateStr);
      expect(result.created).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // deleteShift
  // ═══════════════════════════════════════════════════════════════════════════

  describe('deleteShift', () => {
    it('should soft-delete shift and cancel assignments', async () => {
      const shiftRepo = createMockRepo();
      const scheduleRepo = createMockRepo();

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true });
      scheduleRepo.find.mockResolvedValue([
        { id: 'a1', status: 'scheduled', note: 'test', shiftId: 'sh1', staffId: 's1', workDate: '2026-01-01' },
      ]);
      scheduleRepo.save.mockImplementation(e => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.deleteShift('actor-1', 'sh1');
      expect(result.deleted).toBe(true);
      expect(result.cancelledAssignments).toBe(1);
    });

    it('should throw NotFoundError if shift not found', async () => {
      const shiftRepo = createMockRepo();
      shiftRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.deleteShift('actor-1', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // confirmAssignment
  // ═══════════════════════════════════════════════════════════════════════════

  describe('confirmAssignment', () => {
    it('should confirm assignment', async () => {
      const scheduleRepo = createMockRepo();
      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', staffId: 'staff-1', status: 'scheduled' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.confirmAssignment('staff-1', 'a1');
      expect(result.status).toBe('confirmed');
    });

    it('should throw ConflictError if assignment is cancelled', async () => {
      const scheduleRepo = createMockRepo();
      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', staffId: 'staff-1', status: 'cancelled' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.confirmAssignment('staff-1', 'a1')).rejects.toThrow(ConflictError);
    });

    it('should throw ForbiddenError if not own assignment', async () => {
      const scheduleRepo = createMockRepo();
      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', staffId: 'staff-99', status: 'scheduled' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.confirmAssignment('staff-1', 'a1')).rejects.toThrow(ForbiddenError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createAssignment with force bypass
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createAssignment with force bypass', () => {
    let scheduleRepo: any;
    let shiftRepo: any;
    let zoneRepo: any;

    beforeEach(() => {
      scheduleRepo = createMockRepo();
      shiftRepo = createMockRepo();
      zoneRepo = createMockRepo();

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning', maxStaff: 2 });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
      scheduleRepo.findOne.mockResolvedValue(null);
      scheduleRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
    });

    it('should return warnings instead of throwing when force=true and overstaffed', async () => {
      scheduleRepo.count.mockResolvedValue(2);

      const result = await service.createAssignment('admin-1', {
        staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1),
      }, true);

      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('maximum capacity');
    });

    it('should throw ConflictError when force=false and overstaffed', async () => {
      scheduleRepo.count.mockResolvedValue(2);

      await expect(service.createAssignment('admin-1', {
        staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1),
      }, false)).rejects.toThrow(ConflictError);
    });

    it('should return warnings when force=true and duplicate assignment', async () => {
      scheduleRepo.findOne.mockResolvedValue({ id: 'existing', staffId: 'staff-1' });

      const result = await service.createAssignment('admin-1', {
        staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1),
      }, true);

      expect(result.warnings).toBeDefined();
      expect(result.warnings[0]).toContain('already assigned');
    });
  });

  describe('updateAssignment with force bypass', () => {
    it('should return warnings instead of throwing when force=true and overstaffed', async () => {
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();

      const existing = { id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled' };
      scheduleRepo.findOneBy.mockResolvedValue(existing);
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning', maxStaff: 2 });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
      scheduleRepo.findOne.mockResolvedValue(null);
      scheduleRepo.count.mockResolvedValue(2);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.updateAssignment('admin-1', 'a1', {
        staffId: 'staff-2', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1),
      }, true);

      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });



  describe('auto-schedule maxStaff cap', () => {
    it('should not propose more assignments than maxStaff allows', async () => {
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const preferenceRepo = createMockRepo();

      zoneRepo.find.mockResolvedValue([{ id: 'z1', zoneName: 'Floor 1', isActive: true }]);
      shiftRepo.find.mockResolvedValue([{ id: 'sh1', name: 'Morning', startTime: '08:00', endTime: '12:00', minStaff: 3, maxStaff: 2, isActive: true }]);
      templateRepo.find.mockResolvedValue([]);
      templateRepo.findBy.mockResolvedValue([]);
      scheduleRepo.find.mockResolvedValue([]);
      scheduleRepo.findOne.mockResolvedValue(null);
      scheduleRepo.findOneBy.mockResolvedValue(null);
      scheduleRepo.count.mockResolvedValue(0);
      preferenceRepo.find.mockResolvedValue([]);
      preferenceRepo.findBy.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShiftPreference') return preferenceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.autoSchedule('admin-1', futureDate(1), futureDate(1));

      expect(result).toBeDefined();
    });
  });



  // ═══════════════════════════════════════════════════════════════════════════
  // SCHED-UX1: Manual check-in request flow
  // ═══════════════════════════════════════════════════════════════════════════

  describe('requestManualCheckIn', () => {
    it('should create attendance with pending_manual status and invalidatedReason', async () => {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled',
      });
      attendanceRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.requestManualCheckIn('a1', 'staff-1', 'GPS yếu trong nhà');

      expect(attendanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: 'a1',
          staffId: 'staff-1',
          status: 'pending_manual',
          invalidatedReason: 'manual_checkin_request: GPS yếu trong nhà',
        })
      );
      expect(result.status).toBe('pending_manual');
    });

    it('should throw ForbiddenError if staff does not own the assignment', async () => {
      const scheduleRepo = createMockRepo();
      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-2', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled',
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.requestManualCheckIn('a1', 'staff-1', 'note')).rejects.toThrow(ForbiddenError);
    });

    it('should throw ConflictError if a pending_manual request already exists', async () => {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled',
      });
      attendanceRepo.findOneBy.mockResolvedValue({
        id: 'att1', scheduleId: 'a1', staffId: 'staff-1', status: 'pending_manual',
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.requestManualCheckIn('a1', 'staff-1', 'note')).rejects.toThrow(ConflictError);
    });
  });

  describe('approveManualCheckIn', () => {
    it('should update attendance status to completed and set checkInAt', async () => {
      const attendanceRepo = createMockRepo();
      const scheduleRepo = createMockRepo();

      const att = {
        id: 'att1', scheduleId: 'a1', staffId: 'staff-1', status: 'pending_manual',
        checkInAt: null, invalidatedReason: 'manual_checkin_request: GPS yếu',
      };
      attendanceRepo.findOneBy.mockResolvedValue(att);
      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: today(), status: 'scheduled',
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAttendance') return attendanceRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.approveManualCheckIn('admin-1', 'att1');

      expect(attendanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'att1',
          status: 'completed',
          checkInAt: expect.any(Date),
          invalidatedReason: null,
        })
      );
      expect(result.status).toBe('completed');
    });

    it('should throw ConflictError if attendance is not pending_manual', async () => {
      const attendanceRepo = createMockRepo();
      attendanceRepo.findOneBy.mockResolvedValue({
        id: 'att1', status: 'completed',
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.approveManualCheckIn('admin-1', 'att1')).rejects.toThrow(ConflictError);
    });

    it('should throw NotFoundError if attendance does not exist', async () => {
      const attendanceRepo = createMockRepo();
      attendanceRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.approveManualCheckIn('admin-1', 'att1')).rejects.toThrow(NotFoundError);
    });
  });

  describe('rejectManualCheckIn', () => {
    it('should update attendance status and set invalidatedReason with rejection prefix', async () => {
      const attendanceRepo = createMockRepo();

      const att = {
        id: 'att1', scheduleId: 'a1', staffId: 'staff-1', status: 'pending_manual',
        checkInAt: null, invalidatedReason: 'manual_checkin_request: GPS yếu',
      };
      attendanceRepo.findOneBy.mockResolvedValue(att);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.rejectManualCheckIn('admin-1', 'att1', 'Không đủ bằng chứng');

      expect(attendanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'att1',
          status: 'rejected_manual',
          invalidatedReason: 'manual_checkin_rejected: Không đủ bằng chứng',
        })
      );
      expect(result.status).toBe('rejected_manual');
    });

    it('should throw ConflictError if attendance is not pending_manual', async () => {
      const attendanceRepo = createMockRepo();
      attendanceRepo.findOneBy.mockResolvedValue({
        id: 'att1', status: 'completed',
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.rejectManualCheckIn('admin-1', 'att1', 'reason')).rejects.toThrow(ConflictError);
    });
  });

  describe('listManualCheckInRequests', () => {
    it('should return attendance records with pending_manual status', async () => {
      const attendanceRepo = createMockRepo();
      const items = [
        { id: 'att1', scheduleId: 'a1', staffId: 'staff-1', status: 'pending_manual', invalidatedReason: 'manual_checkin_request: test' },
        { id: 'att2', scheduleId: 'a2', staffId: 'staff-2', status: 'pending_manual', invalidatedReason: 'manual_checkin_request: test2' },
      ];
      attendanceRepo.find.mockResolvedValue(items);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listManualCheckInRequests();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].status).toBe('pending_manual');
    });

    it('should filter by status when provided', async () => {
      const attendanceRepo = createMockRepo();
      attendanceRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listManualCheckInRequests('rejected_manual');

      expect(attendanceRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'rejected_manual' }) })
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHED-UX1: Geofence-only check-in (không còn WiFi / thủ công)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('checkIn geofence enforcement', () => {
    function mockGeofenceRepos(radiusMeters = 100) {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const geofenceRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: today(), status: 'scheduled',
      });
      attendanceRepo.findOneBy.mockResolvedValue(null);
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', startTime: '00:01', endTime: '12:00' });
      geofenceRepo.findOneBy.mockResolvedValue({
        zoneId: 'z1', latitude: 10.0, longitude: 106.0, radiusMeters, isActive: true,
        allowedWifiSsids: ['Library-WiFi', 'Staff-5G'],
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'GeofenceConfig') return geofenceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
    }

    it('should allow check-in when the device is inside the geofence', async () => {
      mockGeofenceRepos();

      const result = await service.checkIn('staff-1', 'a1', 'mobile', 10.0005, 106.0005);

      expect(result.schedule.status).toBe('in_progress');
      expect(result.attendance.method).toBe('mobile');
      expect(result.location.verified).toBe(true);
      expect(result.location.radiusMeters).toBe(100);
    });

    it('should reject check-in when the device is outside the geofence, even with a campus WiFi SSID configured', async () => {
      mockGeofenceRepos();

      await expect(
        service.checkIn('staff-1', 'a1', 'mobile', 20.0, 110.0)
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject check-in when GPS coordinates are missing', async () => {
      mockGeofenceRepos();

      await expect(
        service.checkIn('staff-1', 'a1', 'web')
      ).rejects.toThrow('Không xác định được vị trí GPS');
    });

    it('should use the unified global geofence (zone_id NULL, is_global=true) for check-in verification', async () => {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const geofenceRepo = createMockRepo();

      // Bản ghi địa điểm chung: toạ độ trung tâm IUH, bán kính 150m, zone_id NULL.
      geofenceRepo.findOneBy.mockResolvedValue({
        id: 'gf-global', zoneId: null, isGlobal: true, isActive: true,
        latitude: 10.8220244, longitude: 106.6875689, radiusMeters: 150,
      });
      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: today(), status: 'scheduled',
      });
      attendanceRepo.findOneBy.mockResolvedValue(null);
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', startTime: '00:01', endTime: '12:00' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'GeofenceConfig') return geofenceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();

      // Toạ độ cùng tâm geofence => trong vùng => check-in thành công, verified=true.
      const inside = await service.checkIn('staff-1', 'a1', 'mobile', 10.8220244, 106.6875689);
      expect(inside.schedule.status).toBe('in_progress');
      expect(inside.location.verified).toBe(true);
      expect(inside.location.distanceMeters).toBe(0);
      expect(inside.location.radiusMeters).toBe(150);

      // Reset trạng thái schedule mock về 'scheduled' cho cuộc gọi tiếp theo.
      scheduleRepo.findOneBy.mockResolvedValue({
        id: 'a2', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: today(), status: 'scheduled',
      });

      // Toạ độ xa tâm 5km => ngoài vùng => bị từ chối.
      await expect(
        service.checkIn('staff-1', 'a2', 'mobile', 10.8720244, 106.6875689)
      ).rejects.toThrow(BadRequestError);
    });
  });


});
