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

jest.mock('../data-source', () => ({
  AppDataSource: {
    getRepository: jest.fn().mockImplementation((entity: any) => {
      const name = entity?.name || String(entity);
      if (!mockRepos[name]) mockRepos[name] = createMockRepo();
      return mockRepos[name];
    }),
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const mockManager = {
        create: jest.fn().mockImplementation((entity, data) => data),
        save: jest.fn().mockImplementation((entity, data) => Promise.resolve(data)),
      };
      return cb(mockManager);
    }),
  },
}));

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

      scheduleRepo.findOneBy
        .mockResolvedValueOnce({ id: 'a1', staffId: 'staff-1', shiftId: 'sh1', workDate: '2026-07-01' }) // requester assignment
        .mockResolvedValueOnce({ id: 'a2', staffId: 'staff-2', shiftId: 'sh2', workDate: '2026-07-01' }) // target assignment
        .mockResolvedValueOnce({ id: 'a1', staffId: 'staff-1', shiftId: 'sh1', workDate: '2026-07-01' }) // inside respondSwap load again
        .mockResolvedValueOnce({ id: 'a2', staffId: 'staff-2', shiftId: 'sh2', workDate: '2026-07-01' });

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
      // Verify staffIds were swapped
      expect(scheduleRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'a1', staffId: 'staff-2' }),
        expect.objectContaining({ id: 'a2', staffId: 'staff-1' }),
      ]);
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
});
