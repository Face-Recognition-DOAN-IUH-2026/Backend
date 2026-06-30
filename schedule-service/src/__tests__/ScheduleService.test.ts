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
    let availabilityRepo: any;

    beforeEach(() => {
      scheduleRepo = createMockRepo();
      shiftRepo = createMockRepo();
      zoneRepo = createMockRepo();
      availabilityRepo = createMockRepo();

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
      scheduleRepo.findOne.mockResolvedValue(null);
      scheduleRepo.findOneBy.mockResolvedValue(null);
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
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

    it('should throw ConflictError if staff has approved leave', async () => {
      scheduleRepo.findOne.mockResolvedValue(null); // no duplicate
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'leave-1', status: 'approved' }),
      });

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
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
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
  // respondSwap
  // ═══════════════════════════════════════════════════════════════════════════

  describe('respondSwap', () => {
    it('should accept swap and swap staffIds on two assignments', async () => {
      const swapRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();

      swapRepo.findOneBy.mockResolvedValue({
        id: 'sw1', targetStaffId: 'staff-2', requesterStaffId: 'staff-1',
        requesterAssignmentId: 'a1', targetAssignmentId: 'a2', status: 'pending',
      });

      scheduleRepo.findOne
        .mockResolvedValueOnce({ id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: '2026-07-01' })
        .mockResolvedValueOnce({ id: 'a2', staffId: 'staff-2', shiftId: 'sh2', zoneId: 'z1', workDate: '2026-07-01' });
      scheduleRepo.findOne.mockResolvedValue(null);

      shiftRepo.findOneBy.mockImplementation((query: any) => {
        if (query.id === 'sh1') return Promise.resolve({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
        if (query.id === 'sh2') return Promise.resolve({ id: 'sh2', isActive: true, startTime: '13:00', endTime: '17:00', name: 'Afternoon' });
        return Promise.resolve(null);
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.respondSwap('staff-2', 'sw1', 'accepted');
      expect(result.status).toBe('accepted');
    });

    it('should reject swap without modifying assignments', async () => {
      const swapRepo = createMockRepo();
      swapRepo.findOneBy.mockResolvedValue({
        id: 'sw1', targetStaffId: 'staff-2', requesterStaffId: 'staff-1',
        requesterAssignmentId: 'a1', targetAssignmentId: null, status: 'pending',
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.respondSwap('staff-2', 'sw1', 'rejected');
      expect(result.status).toBe('rejected');
    });

    it('should throw ConflictError if swap is not pending', async () => {
      const swapRepo = createMockRepo();
      swapRepo.findOneBy.mockResolvedValue({
        id: 'sw1', targetStaffId: 'staff-2', status: 'accepted',
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.respondSwap('staff-2', 'sw1', 'accepted')).rejects.toThrow(ConflictError);
    });

    it('should throw ForbiddenError if not addressed to responding staff', async () => {
      const swapRepo = createMockRepo();
      swapRepo.findOneBy.mockResolvedValue({
        id: 'sw1', targetStaffId: 'staff-99', status: 'pending',
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.respondSwap('staff-2', 'sw1', 'accepted')).rejects.toThrow(ForbiddenError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // reviewBid
  // ═══════════════════════════════════════════════════════════════════════════

  describe('reviewBid', () => {
    it('should approve bid and reassign assignment', async () => {
      const bidRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const availabilityRepo = createMockRepo();

      bidRepo.findOneBy.mockResolvedValue({ id: 'b1', status: 'pending', staffId: 'staff-2', assignmentId: 'a1' });
      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', staffId: 'staff-1', note: 'Original', workDate: '2026-07-01', shiftId: 'sh1' });
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.reviewBid('admin-1', 'b1', 'approved');
      expect(result.status).toBe('approved');
      expect(scheduleRepo.save).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'staff-2' }));
    });

    it('should reject bid without reassigning', async () => {
      const bidRepo = createMockRepo();
      bidRepo.findOneBy.mockResolvedValue({ id: 'b1', status: 'pending', staffId: 'staff-2', assignmentId: 'a1' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.reviewBid('admin-1', 'b1', 'rejected');
      expect(result.status).toBe('rejected');
    });

    it('should throw ConflictError if bid is not pending', async () => {
      const bidRepo = createMockRepo();
      bidRepo.findOneBy.mockResolvedValue({ id: 'b1', status: 'approved' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.reviewBid('admin-1', 'b1', 'approved')).rejects.toThrow(ConflictError);
    });

    it('should throw ConflictError during approval if staff has approved leave', async () => {
      const bidRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const availabilityRepo = createMockRepo();

      bidRepo.findOneBy.mockResolvedValue({ id: 'b1', status: 'pending', staffId: 'staff-2', assignmentId: 'a1' });
      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', staffId: 'staff-1', workDate: '2026-07-01', shiftId: 'sh1' });
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'l1', status: 'approved' }),
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.reviewBid('admin-1', 'b1', 'approved')).rejects.toThrow(ConflictError);
    });

    it('should throw ConflictError during approval if staff has overlapping shift', async () => {
      const bidRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const availabilityRepo = createMockRepo();

      bidRepo.findOneBy.mockResolvedValue({ id: 'b1', status: 'pending', staffId: 'staff-2', assignmentId: 'a1' });
      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', staffId: 'staff-1', workDate: '2026-07-01', shiftId: 'sh1' });
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      scheduleRepo.find.mockResolvedValue([
        { id: 'a2', workDate: '2026-07-01', shiftId: 'sh2', staffId: 'staff-2', status: 'scheduled' }
      ]);
      shiftRepo.findOneBy.mockImplementation((query: any) => {
        if (query.id === 'sh1') return Promise.resolve({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
        if (query.id === 'sh2') return Promise.resolve({ id: 'sh2', isActive: true, startTime: '10:00', endTime: '14:00', name: 'Overlap' });
        return Promise.resolve(null);
      });
      shiftRepo.find.mockResolvedValue([
        { id: 'sh2', isActive: true, startTime: '10:00', endTime: '14:00', name: 'Overlap' }
      ]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.reviewBid('admin-1', 'b1', 'approved')).rejects.toThrow(ConflictError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createBid
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createBid', () => {
    it('should create bid on scheduled assignment', async () => {
      const bidRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const availabilityRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', status: 'scheduled', workDate: '2026-07-01', shiftId: 'sh1' });
      bidRepo.findOneBy.mockResolvedValue(null); // no existing bid
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.createBid('staff-1', 'a1', 'I want this shift');
      expect(result.staffId).toBe('staff-1');
      expect(result.assignmentId).toBe('a1');
    });

    it('should throw ConflictError if assignment is not scheduled', async () => {
      const scheduleRepo = createMockRepo();
      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', status: 'completed' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.createBid('staff-1', 'a1')).rejects.toThrow(ConflictError);
    });

    it('should throw ConflictError if duplicate pending bid exists', async () => {
      const bidRepo = createMockRepo();
      const scheduleRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', status: 'scheduled' });
      bidRepo.findOneBy.mockResolvedValue({ id: 'existing-bid', staffId: 'staff-1', status: 'pending' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.createBid('staff-1', 'a1')).rejects.toThrow(ConflictError);
    });

    it('should throw ConflictError if staff has approved leave on assignment date', async () => {
      const bidRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const availabilityRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', status: 'scheduled', workDate: '2026-07-01', shiftId: 'sh1' });
      bidRepo.findOneBy.mockResolvedValue(null);
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'l1', type: 'unavailable', status: 'approved' }),
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.createBid('staff-1', 'a1')).rejects.toThrow(ConflictError);
    });

    it('should throw ConflictError if staff has overlapping shift on assignment date', async () => {
      const bidRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const availabilityRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', status: 'scheduled', workDate: '2026-07-01', shiftId: 'sh1' });
      bidRepo.findOneBy.mockResolvedValue(null);
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      scheduleRepo.find.mockResolvedValue([
        { id: 'a2', workDate: '2026-07-01', shiftId: 'sh2', staffId: 'staff-1', status: 'scheduled' }
      ]);
      shiftRepo.findOneBy.mockImplementation((query: any) => {
        if (query.id === 'sh1') return Promise.resolve({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
        if (query.id === 'sh2') return Promise.resolve({ id: 'sh2', isActive: true, startTime: '10:00', endTime: '14:00', name: 'Overlap' });
        return Promise.resolve(null);
      });
      shiftRepo.find.mockResolvedValue([
        { id: 'sh2', isActive: true, startTime: '10:00', endTime: '14:00', name: 'Overlap' }
      ]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.createBid('staff-1', 'a1')).rejects.toThrow(ConflictError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // openShifts
  // ═══════════════════════════════════════════════════════════════════════════

  describe('openShifts', () => {
    it('should find unfilled shift slots', async () => {
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();

      scheduleRepo.find.mockResolvedValue([]); // no existing assignments
      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 2, isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' },
      ]);
      zoneRepo.findBy.mockResolvedValue([
        { id: 'z1', isActive: true, floor: 1, zoneName: 'A' },
      ]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.openShifts();
      // Should have open slots for each of the next 14 days * 2 minStaff
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('shift');
      expect(result[0]).toHaveProperty('zone');
      expect(result[0]).toHaveProperty('workDate');
    });

    it('should return empty if all shifts are fully staffed', async () => {
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();

      const todayStr = today();
      scheduleRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { shift_id: 'sh1', zone_id: 'z1', work_date: todayStr, assigned: '2' }
        ]),
      });
      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 2, isActive: true },
      ]);
      zoneRepo.findBy.mockResolvedValue([
        { id: 'z1', isActive: true },
      ]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.openShifts();
      // Only today should be fully staffed; other 13 days still have open slots
      const todaySlots = result.filter(r => r.workDate === todayStr);
      expect(todaySlots.length).toBe(0);
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
      const availabilityRepo = createMockRepo();

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
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
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
  // cancelBid
  // ═══════════════════════════════════════════════════════════════════════════

  describe('cancelBid', () => {
    it('should cancel own pending bid', async () => {
      const bidRepo = createMockRepo();
      bidRepo.findOneBy.mockResolvedValue({ id: 'b1', staffId: 'staff-1', status: 'pending' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.cancelBid('staff-1', 'b1');
      expect(result.status).toBe('cancelled');
    });

    it('should throw ForbiddenError if not own bid', async () => {
      const bidRepo = createMockRepo();
      bidRepo.findOneBy.mockResolvedValue({ id: 'b1', staffId: 'staff-99', status: 'pending' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.cancelBid('staff-1', 'b1')).rejects.toThrow(ForbiddenError);
    });

    it('should throw ConflictError if bid is not pending', async () => {
      const bidRepo = createMockRepo();
      bidRepo.findOneBy.mockResolvedValue({ id: 'b1', staffId: 'staff-1', status: 'approved' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.cancelBid('staff-1', 'b1')).rejects.toThrow(ConflictError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createAvailability & createAssignmentsBulk
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createAvailability with overlap check', () => {
    it('should throw ConflictError if there is an overlapping leave request', async () => {
      const availRepo = createMockRepo();
      availRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'av-existing', staffId: 'staff-1', status: 'approved' }),
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.createAvailability('staff-1', { dateFrom: '2026-07-01', dateTo: '2026-07-05' })).rejects.toThrow(ConflictError);
    });
  });

  describe('createAssignmentsBulk', () => {
    it('should save assignments successfully if no conflicts', async () => {
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const availRepo = createMockRepo();

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', startTime: '08:00', endTime: '12:00', maxStaff: 5 });
      shiftRepo.find.mockResolvedValue([{ id: 'sh1', startTime: '08:00', endTime: '12:00', maxStaff: 5 }]);
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
      availRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });



      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const items = [{ staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1) }];
      const result = await service.createAssignmentsBulk('admin-1', items);
      expect(result).toHaveLength(1);
      expect(result[0].staffId).toBe('staff-1');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAFF-SCHEDULES IMPROVEMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createAssignment with force bypass', () => {
    let scheduleRepo: any;
    let shiftRepo: any;
    let zoneRepo: any;
    let availabilityRepo: any;

    beforeEach(() => {
      scheduleRepo = createMockRepo();
      shiftRepo = createMockRepo();
      zoneRepo = createMockRepo();
      availabilityRepo = createMockRepo();

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning', maxStaff: 2 });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
      scheduleRepo.findOne.mockResolvedValue(null);
      scheduleRepo.findOneBy.mockResolvedValue(null);
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
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
      const availabilityRepo = createMockRepo();

      const existing = { id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled' };
      scheduleRepo.findOneBy.mockResolvedValue(existing);
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning', maxStaff: 2 });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
      scheduleRepo.findOne.mockResolvedValue(null);
      scheduleRepo.count.mockResolvedValue(2);
      availabilityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffAvailabilityRequest') return availabilityRepo;
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

  describe('expireStaleBidsInternal', () => {
    it('should expire bids older than 72h and warn at 48h', async () => {
      const bidRepo = createMockRepo();
      const auditRepo = createMockRepo();

      const now = new Date();
      const fiftyHoursAgo = new Date(now.getTime() - 50 * 60 * 60 * 1000);
      const eightyHoursAgo = new Date(now.getTime() - 80 * 60 * 60 * 1000);

      const warningBid = { id: 'b1', status: 'pending', createdAt: fiftyHoursAgo, notifiedExpiring: false, staffId: 'staff-1', assignmentId: 'a1' };
      const expiredBid = { id: 'b2', status: 'pending', createdAt: eightyHoursAgo, notifiedExpiring: true, staffId: 'staff-2', assignmentId: 'a2', note: null };

      bidRepo.find
        .mockResolvedValueOnce([warningBid])
        .mockResolvedValueOnce([expiredBid]);
      bidRepo.save.mockImplementation((e: any) => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'ScheduleAuditLog') return auditRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.expireStaleBidsInternal();

      expect(result.warned).toBe(1);
      expect(result.expired).toBe(1);
      expect(publishEvent).toHaveBeenCalledWith('bid.expiring_soon', expect.objectContaining({ bidId: 'b1' }));
    });

    it('should return zero counts when no stale bids', async () => {
      const bidRepo = createMockRepo();
      bidRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.expireStaleBidsInternal();
      expect(result).toEqual({ warned: 0, expired: 0 });
    });
  });

  describe('expireStaleSwapsInternal', () => {
    it('should expire swaps older than 72h and warn at 48h', async () => {
      const swapRepo = createMockRepo();
      const auditRepo = createMockRepo();

      const now = new Date();
      const fiftyHoursAgo = new Date(now.getTime() - 50 * 60 * 60 * 1000);
      const eightyHoursAgo = new Date(now.getTime() - 80 * 60 * 60 * 1000);

      const warningSwap = { id: 'sw1', status: 'pending', createdAt: fiftyHoursAgo, notifiedExpiring: false, requesterStaffId: 'staff-1', targetStaffId: 'staff-2' };
      const expiredSwap = { id: 'sw2', status: 'pending', createdAt: eightyHoursAgo, notifiedExpiring: true, requesterStaffId: 'staff-3', targetStaffId: 'staff-4' };

      swapRepo.find
        .mockResolvedValueOnce([warningSwap])
        .mockResolvedValueOnce([expiredSwap]);
      swapRepo.save.mockImplementation((e: any) => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (name === 'ScheduleAuditLog') return auditRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.expireStaleSwapsInternal();

      expect(result.warned).toBe(1);
      expect(result.expired).toBe(1);
      expect(publishEvent).toHaveBeenCalledWith('swap.expiring_soon', expect.objectContaining({ swapId: 'sw1' }));
    });
  });

  describe('soft delete attendance', () => {
    it('should use softRemove with invalidatedReason instead of hard remove', async () => {
      const scheduleRepo = createMockRepo();
      const attendanceRepo = createMockRepo();
      const availRepo = createMockRepo();

      const assignment = { id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled' };
      scheduleRepo.find.mockResolvedValue([assignment]);

      const att = { id: 'att1', scheduleId: 'a1', checkInAt: new Date(), status: 'checked-in' };
      attendanceRepo.findOneBy.mockResolvedValue(att);

      const leaveAvail = { id: 'avail-1', staffId: 'staff-1', status: 'pending' };
      availRepo.findOneBy.mockResolvedValue(leaveAvail);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await service.reviewAvailability('admin-1', 'avail-1', 'approved');

      expect(attendanceRepo.softRemove).toHaveBeenCalledWith(expect.objectContaining({ invalidatedReason: 'leave.approved' }));
      expect(attendanceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ invalidatedReason: 'leave.approved' }));
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

  describe('listBids does not auto-expire', () => {
    it('should list bids without calling expireStaleBids', async () => {
      const bidRepo = createMockRepo();
      bidRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listBids('staff-1');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('listSwaps does not auto-expire', () => {
    it('should list swaps without calling expireStaleSwaps', async () => {
      const swapRepo = createMockRepo();
      swapRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listSwaps('staff-1');
      expect(Array.isArray(result)).toBe(true);
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
  // SCHED-UX1: WiFi SSID fallback in check-in
  // ═══════════════════════════════════════════════════════════════════════════

  describe('checkIn with WiFi SSID fallback', () => {
    it('should allow check-in via WiFi when GPS fails but wifiSsid matches', async () => {
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
        zoneId: 'z1', latitude: 10.0, longitude: 106.0, radiusMeters: 100, isActive: true,
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
      // GPS far away, but WiFi matches
      const result = await service.checkIn('staff-1', 'a1', 'geofence', 20.0, 110.0, 'Library-WiFi');

      expect(result.schedule.status).toBe('in_progress');
      expect(result.attendance.method).toBe('wifi');
    });

    it('should throw BadRequestError when GPS fails and wifiSsid does not match', async () => {
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
        zoneId: 'z1', latitude: 10.0, longitude: 106.0, radiusMeters: 100, isActive: true,
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
      // GPS far away AND wrong WiFi
      await expect(
        service.checkIn('staff-1', 'a1', 'geofence', 20.0, 110.0, 'Random-Cafe-WiFi')
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw BadRequestError with manual-checkin suggestion when GPS+WiFi both fail and no wifiSsid provided', async () => {
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
        zoneId: 'z1', latitude: 10.0, longitude: 106.0, radiusMeters: 100, isActive: true,
        allowedWifiSsids: ['Library-WiFi'],
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
      // GPS far away, no wifiSsid provided — error message should suggest manual check-in
      await expect(
        service.checkIn('staff-1', 'a1', 'geofence', 20.0, 110.0)
      ).rejects.toThrow('thủ công');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHED-UX1: Auto-approve bids for understaffed shifts
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createBid auto-approve for understaffed shifts', () => {
    it('should auto-approve bid when shift current count < minStaff', async () => {
      const scheduleRepo = createMockRepo();
      const bidRepo = createMockRepo();
      const shiftRepo = createMockRepo();

      const assignment = { id: 'a1', staffId: 'staff-2', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled', note: null };
      const shift = { id: 'sh1', startTime: '08:00', endTime: '12:00', minStaff: 3, maxStaff: 5, isActive: true };

      scheduleRepo.findOneBy.mockResolvedValue(assignment);
      shiftRepo.findOneBy.mockResolvedValue(shift);
      bidRepo.findOneBy.mockResolvedValue(null);
      scheduleRepo.count.mockResolvedValue(1);
      bidRepo.save.mockImplementation((e: any) => Promise.resolve({ ...e, id: 'bid-1' }));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.createBid('staff-1', 'a1');

      expect(bidRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved' })
      );
      expect(result.status).toBe('approved');
      expect(publishEvent).toHaveBeenCalledWith('bid.auto_approved', expect.any(Object));
    });

    it('should leave bid pending when shift count >= minStaff', async () => {
      const scheduleRepo = createMockRepo();
      const bidRepo = createMockRepo();
      const shiftRepo = createMockRepo();

      const assignment = { id: 'a1', staffId: 'staff-2', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled', note: null };
      const shift = { id: 'sh1', startTime: '08:00', endTime: '12:00', minStaff: 2, maxStaff: 5, isActive: true };

      scheduleRepo.findOneBy.mockResolvedValue(assignment);
      shiftRepo.findOneBy.mockResolvedValue(shift);
      bidRepo.findOneBy.mockResolvedValue(null);
      scheduleRepo.count.mockResolvedValue(3);
      bidRepo.save.mockImplementation((e: any) => Promise.resolve({ ...e, id: 'bid-2' }));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.createBid('staff-1', 'a1');

      expect(bidRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' })
      );
      expect(result.status).toBe('pending');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHED-UX1: Open swap claim
  // ═══════════════════════════════════════════════════════════════════════════

  describe('claimOpenSwap', () => {
    it('should claim open swap and set targetStaffId + status to accepted', async () => {
      const swapRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();

      const swap = {
        id: 'sw1', requesterStaffId: 'staff-1', targetStaffId: null,
        requesterAssignmentId: 'a1', targetAssignmentId: null,
        reason: 'Need off', status: 'pending',
      };
      swapRepo.findOneBy.mockResolvedValue(swap);
      swapRepo.save.mockImplementation((e: any) => Promise.resolve(e));
      const reqAssignment = { id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled' };
      scheduleRepo.findOneBy.mockResolvedValue(reqAssignment);
      scheduleRepo.findOne.mockResolvedValue(reqAssignment);
      scheduleRepo.save.mockImplementation((e: any) => Promise.resolve(e));
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', startTime: '08:00', endTime: '12:00', isActive: true });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.claimOpenSwap('staff-2', 'sw1');

      expect(result.targetStaffId).toBe('staff-2');
      expect(result.status).toBe('accepted');
      expect(publishEvent).toHaveBeenCalledWith('swap.claimed', expect.any(Object));
    });

    it('should throw BadRequestError if swap already has a targetStaffId', async () => {
      const swapRepo = createMockRepo();
      const swap = {
        id: 'sw1', requesterStaffId: 'staff-1', targetStaffId: 'staff-3',
        requesterAssignmentId: 'a1', status: 'pending',
      };
      swapRepo.findOneBy.mockResolvedValue(swap);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.claimOpenSwap('staff-2', 'sw1')).rejects.toThrow('not an open swap');
    });

    it('should throw BadRequestError if claiming staff is the requester', async () => {
      const swapRepo = createMockRepo();
      const swap = {
        id: 'sw1', requesterStaffId: 'staff-1', targetStaffId: null,
        requesterAssignmentId: 'a1', status: 'pending',
      };
      swapRepo.findOneBy.mockResolvedValue(swap);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.claimOpenSwap('staff-1', 'sw1')).rejects.toThrow('Cannot claim your own swap');
    });

    it('should throw ConflictError if swap is not pending', async () => {
      const swapRepo = createMockRepo();
      const swap = {
        id: 'sw1', requesterStaffId: 'staff-1', targetStaffId: null,
        requesterAssignmentId: 'a1', status: 'accepted',
      };
      swapRepo.findOneBy.mockResolvedValue(swap);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.claimOpenSwap('staff-2', 'sw1')).rejects.toThrow(ConflictError);
    });

    it('should throw NotFoundError if swap does not exist', async () => {
      const swapRepo = createMockRepo();
      swapRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.claimOpenSwap('staff-2', 'sw-nonexistent')).rejects.toThrow(NotFoundError);
    });
  });
});
