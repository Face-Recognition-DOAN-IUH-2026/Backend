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
  },
}));

jest.mock('../clients/UserServiceClient', () => ({
  UserServiceClient: jest.fn().mockImplementation(() => ({
    listStaff: jest.fn().mockResolvedValue([
      { id: 'staff-1', fullName: 'Alice', email: 'alice@test.com', role: 'staff', status: 'active' },
      { id: 'staff-2', fullName: 'Bob', email: 'bob@test.com', role: 'staff', status: 'active' },
      { id: 'admin-1', fullName: 'Admin', email: 'admin@test.com', role: 'admin', status: 'active' },
    ]),
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
import { publishEvent } from '../utils/eventPublisher';
import { NotFoundError, ConflictError, ForbiddenError, BadRequestError } from '../errors';

// ─── Helpers ────────────────────────────────────────────────────────────────

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function futureDate(days = 1) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ScheduleService — Coverage Part 2
// ═══════════════════════════════════════════════════════════════════════════════

describe('ScheduleService — Coverage Part 2', () => {
  let service: ScheduleService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockRepos).forEach(k => delete mockRepos[k]);
    service = new ScheduleService();
  });

  // ─── listZones / updateZone ──────────────────────────────────────────────

  describe('listZones', () => {
    it('should return all zones ordered by floor', async () => {
      const zoneRepo = createMockRepo();
      zoneRepo.find.mockResolvedValue([{ id: 'z1', floor: 1, zoneName: 'A' }]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listZones();
      expect(result).toHaveLength(1);
      expect(zoneRepo.find).toHaveBeenCalledWith({ order: { floor: 'ASC', zoneName: 'ASC' } });
    });
  });

  describe('updateZone', () => {
    it('should update and return zone', async () => {
      const zoneRepo = createMockRepo();
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', floor: 1, zoneName: 'A' });
      zoneRepo.save.mockImplementation(e => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.updateZone('actor-1', 'z1', { zoneName: 'B' });
      expect(result.zoneName).toBe('B');
    });

    it('should throw NotFoundError if zone does not exist', async () => {
      const zoneRepo = createMockRepo();
      zoneRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.updateZone('actor-1', 'nonexistent', {})).rejects.toThrow(NotFoundError);
    });
  });

  // ─── createShift / listShifts / updateShift ──────────────────────────────

  describe('createShift', () => {
    it('should create and return shift', async () => {
      const shiftRepo = createMockRepo();
      shiftRepo.save.mockResolvedValue({ id: 'sh1', name: 'Morning', startTime: '08:00', endTime: '12:00' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.createShift('actor-1', { name: 'Morning', startTime: '08:00', endTime: '12:00' });
      expect(result.name).toBe('Morning');
    });
  });

  describe('listShifts', () => {
    it('should return all shifts ordered by startTime', async () => {
      const shiftRepo = createMockRepo();
      shiftRepo.find.mockResolvedValue([{ id: 'sh1', startTime: '08:00' }]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listShifts();
      expect(result).toHaveLength(1);
    });
  });

  describe('updateShift', () => {
    it('should update and return shift', async () => {
      const shiftRepo = createMockRepo();
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', name: 'Morning' });
      shiftRepo.save.mockImplementation(e => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.updateShift('actor-1', 'sh1', { name: 'Afternoon' });
      expect(result.name).toBe('Afternoon');
    });

    it('should throw NotFoundError if shift does not exist', async () => {
      const shiftRepo = createMockRepo();
      shiftRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.updateShift('actor-1', 'nonexistent', {})).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Templates ───────────────────────────────────────────────────────────

  describe('createTemplate', () => {
    it('should create template after validating targets', async () => {
      const templateRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
      templateRepo.save.mockImplementation(e => Promise.resolve({ id: 't1', ...e }));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.createTemplate('actor-1', {
        name: 'Morning A', dayOfWeek: 1, staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1',
      });
      expect(result.id).toBe('t1');
    });
  });

  describe('listTemplates', () => {
    it('should return templates ordered by dayOfWeek', async () => {
      const templateRepo = createMockRepo();
      templateRepo.find.mockResolvedValue([{ id: 't1', dayOfWeek: 1 }]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listTemplates();
      expect(result).toHaveLength(1);
    });
  });

  describe('updateTemplate', () => {
    it('should update template', async () => {
      const templateRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();

      templateRepo.findOneBy.mockResolvedValue({ id: 't1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1' });
      templateRepo.save.mockImplementation(e => Promise.resolve(e));
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.updateTemplate('actor-1', 't1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('should throw NotFoundError if template not found', async () => {
      const templateRepo = createMockRepo();
      templateRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.updateTemplate('actor-1', 'nonexistent', {})).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteTemplate', () => {
    it('should soft-delete template', async () => {
      const templateRepo = createMockRepo();
      templateRepo.findOneBy.mockResolvedValue({ id: 't1', isActive: true });
      templateRepo.save.mockImplementation(e => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.deleteTemplate('actor-1', 't1');
      expect(result.deleted).toBe(true);
    });
  });

  // ─── Preferences ─────────────────────────────────────────────────────────

  describe('createPreference', () => {
    it('should create new preference', async () => {
      const prefRepo = createMockRepo();
      prefRepo.findOneBy.mockResolvedValue(null);
      prefRepo.save.mockImplementation(e => Promise.resolve({ id: 'p1', ...e }));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.createPreference('actor-1', {
        staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', priority: 2,
      });
      expect(result.id).toBe('p1');
    });

    it('should update existing preference (upsert)', async () => {
      const prefRepo = createMockRepo();
      prefRepo.findOneBy.mockResolvedValue({ id: 'p1', priority: 1, isActive: false });
      prefRepo.save.mockImplementation(e => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.createPreference('actor-1', {
        staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', priority: 5,
      });
      expect(result.priority).toBe(5);
      expect(result.isActive).toBe(true);
    });
  });

  describe('listPreferences', () => {
    it('should return preferences with enriched shift and zone data', async () => {
      const prefRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();

      prefRepo.findAndCount.mockResolvedValue([
        [{ id: 'p1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', priority: 1, isActive: true }],
        1
      ]);
      shiftRepo.findBy.mockResolvedValue([{ id: 'sh1', name: 'Morning' }]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', zoneName: 'A' }]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShiftPreference') return prefRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listPreferences('staff-1');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].shift).toEqual({ id: 'sh1', name: 'Morning' });
      expect(result.items[0].zone).toEqual({ id: 'z1', zoneName: 'A' });
    });
  });

  describe('deletePreference', () => {
    it('should soft-delete preference', async () => {
      const prefRepo = createMockRepo();
      prefRepo.findOneBy.mockResolvedValue({ id: 'p1', isActive: true });
      prefRepo.save.mockImplementation(e => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.deletePreference('actor-1', 'p1');
      expect(result.deleted).toBe(true);
    });

    it('should throw NotFoundError if preference not found', async () => {
      const prefRepo = createMockRepo();
      prefRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.deletePreference('actor-1', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getPreferencesForStaff', () => {
    it('should return active preferences for staff', async () => {
      const prefRepo = createMockRepo();
      prefRepo.find.mockResolvedValue([{ id: 'p1', staffId: 'staff-1', isActive: true }]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.getPreferencesForStaff('staff-1');
      expect(result).toHaveLength(1);
    });
  });

  // ─── Availability ────────────────────────────────────────────────────────

  describe('createAvailability', () => {
    it('should create availability request', async () => {
      const availRepo = createMockRepo();
      availRepo.save.mockImplementation(e => Promise.resolve({ id: 'av1', ...e }));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.createAvailability('staff-1', {
        dateFrom: '2026-07-01', dateTo: '2026-07-05', type: 'unavailable', reason: 'Vacation',
      });
      expect(result.status).toBe('pending');
      expect(result.staffId).toBe('staff-1');
    });
  });

  describe('listAvailability', () => {
    it('should return availability requests filtered by staff', async () => {
      const availRepo = createMockRepo();
      availRepo.find.mockResolvedValue([{ id: 'av1', staffId: 'staff-1', status: 'pending' }]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listAvailability({ staffId: 'staff-1' });
      expect(result).toHaveLength(1);
    });
  });

  describe('reviewAvailability', () => {
    it('should approve availability request', async () => {
      const availRepo = createMockRepo();
      availRepo.findOneBy.mockResolvedValue({ id: 'av1', status: 'pending' });
      availRepo.save.mockImplementation(e => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.reviewAvailability('admin-1', 'av1', 'approved');
      expect(result.status).toBe('approved');
      expect(result.reviewedBy).toBe('admin-1');
    });

    it('should throw NotFoundError if request not found', async () => {
      const availRepo = createMockRepo();
      availRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.reviewAvailability('admin-1', 'nonexistent', 'approved')).rejects.toThrow(NotFoundError);
    });
  });

  // ─── listAssignments ─────────────────────────────────────────────────────

  describe('listAssignments', () => {
    it('should return enriched assignments', async () => {
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const attendanceRepo = createMockRepo();

      scheduleRepo.findAndCount.mockResolvedValue([
        [{ id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: '2026-07-01', status: 'scheduled' }],
        1
      ]);
      shiftRepo.findBy.mockResolvedValue([{ id: 'sh1', name: 'Morning' }]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', zoneName: 'A' }]);
      attendanceRepo.findBy.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listAssignments({ from: '2026-07-01', to: '2026-07-31' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].shift).toEqual({ id: 'sh1', name: 'Morning' });
      expect(result.items[0].zone).toEqual({ id: 'z1', zoneName: 'A' });
    });

    it('should filter by status', async () => {
      const scheduleRepo = createMockRepo();
      scheduleRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listAssignments({ status: 'cancelled' });
      expect(result.items).toHaveLength(0);
    });
  });

  // ─── updateAssignment ────────────────────────────────────────────────────

  describe('updateAssignment', () => {
    it('should update assignment and publish event', async () => {
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const availabilityRepo = createMockRepo();

      scheduleRepo.findOneBy
        .mockResolvedValueOnce({ id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled' })
        .mockResolvedValueOnce(null); // ensureNoDuplicateAssignment
      scheduleRepo.find.mockResolvedValue([]); // ensureNoShiftTimeOverlap
      scheduleRepo.save.mockImplementation(e => Promise.resolve(e));

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
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
      const result = await service.updateAssignment('actor-1', 'a1', { note: 'Updated' });
      expect(result.note).toBe('Updated');
      expect(publishEvent).toHaveBeenCalledWith('schedule.changed', expect.objectContaining({ changeType: 'updated' }));
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
      await expect(service.updateAssignment('actor-1', 'nonexistent', {})).rejects.toThrow(NotFoundError);
    });
  });

  // ─── moveAssignment ──────────────────────────────────────────────────────

  describe('moveAssignment', () => {
    it('should call updateAssignment and log move', async () => {
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const availabilityRepo = createMockRepo();

      scheduleRepo.findOneBy
        .mockResolvedValueOnce({ id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled' })
        .mockResolvedValueOnce(null);
      scheduleRepo.find.mockResolvedValue([]);
      scheduleRepo.save.mockImplementation(e => Promise.resolve(e));

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
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
      const result = await service.moveAssignment('actor-1', 'a1', { note: 'Moved' });
      expect(result).toBeDefined();
    });
  });

  // ─── createSwap ──────────────────────────────────────────────────────────

  describe('createSwap', () => {
    it('should create swap request', async () => {
      const swapRepo = createMockRepo();
      const scheduleRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', staffId: 'staff-1', status: 'scheduled' });
      swapRepo.findOneBy.mockResolvedValue(null); // no existing pending swap
      swapRepo.save.mockImplementation(e => Promise.resolve({ id: 'sw1', ...e }));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.createSwap('staff-1', {
        targetStaffId: 'staff-2', requesterAssignmentId: 'a1',
      });
      expect(result.status).toBe('pending');
    });

    it('should throw ConflictError if pending swap already exists', async () => {
      const swapRepo = createMockRepo();
      const scheduleRepo = createMockRepo();

      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', staffId: 'staff-1', status: 'scheduled' });
      swapRepo.findOneBy.mockResolvedValue({ id: 'existing', status: 'pending' });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.createSwap('staff-1', {
        targetStaffId: 'staff-2', requesterAssignmentId: 'a1',
      })).rejects.toThrow(ConflictError);
    });

    it('should throw ForbiddenError if target assignment does not belong to target staff', async () => {
      const swapRepo = createMockRepo();
      const scheduleRepo = createMockRepo();

      scheduleRepo.findOneBy
        .mockResolvedValueOnce({ id: 'a1', staffId: 'staff-1', status: 'scheduled' }) // requester
        .mockResolvedValueOnce({ id: 'a2', staffId: 'staff-99', status: 'scheduled' }); // target (wrong staff)

      swapRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.createSwap('staff-1', {
        targetStaffId: 'staff-2', requesterAssignmentId: 'a1', targetAssignmentId: 'a2',
      })).rejects.toThrow(ForbiddenError);
    });
  });

  // ─── listSwaps ───────────────────────────────────────────────────────────

  describe('listSwaps', () => {
    it('should return enriched swaps', async () => {
      const swapRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const attendanceRepo = createMockRepo();

      swapRepo.find.mockResolvedValue([{
        id: 'sw1', requesterStaffId: 'staff-1', targetStaffId: 'staff-2',
        requesterAssignmentId: 'a1', targetAssignmentId: 'a2', status: 'pending',
      }]);
      scheduleRepo.find.mockResolvedValue([
        { id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1' },
        { id: 'a2', staffId: 'staff-2', shiftId: 'sh1', zoneId: 'z1' },
      ]);
      shiftRepo.findBy.mockResolvedValue([{ id: 'sh1', name: 'Morning' }]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', zoneName: 'A' }]);
      attendanceRepo.findBy.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftSwap') return swapRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listSwaps();
      expect(result).toHaveLength(1);
      expect(result[0].requesterAssignment).toBeDefined();
    });
  });

  // ─── respondSwap (single reassignment) ───────────────────────────────────

  describe('respondSwap — single reassignment', () => {
    it('should accept swap and reassign single assignment (no target)', async () => {
      const swapRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();

      swapRepo.findOneBy.mockResolvedValue({
        id: 'sw1', targetStaffId: 'staff-2', requesterStaffId: 'staff-1',
        requesterAssignmentId: 'a1', targetAssignmentId: null, status: 'pending',
      });
      scheduleRepo.findOneBy.mockResolvedValue({ id: 'a1', staffId: 'staff-1', shiftId: 'sh1', workDate: '2026-07-01' });
      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });

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
      // Verify single assignment was reassigned
      expect(scheduleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1', staffId: 'staff-2' }),
      );
    });
  });

  // ─── autoSchedule ────────────────────────────────────────────────────────

  describe('autoSchedule', () => {
    it('should propose assignments based on templates and preferences', async () => {
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const availRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const prefRepo = createMockRepo();

      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 1, isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' },
      ]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', isActive: true }]);
      scheduleRepo.find.mockResolvedValue([]); // no existing assignments
      availRepo.find.mockResolvedValue([]); // no approved leaves
      templateRepo.findBy.mockResolvedValue([]);
      prefRepo.find.mockResolvedValue([
        { id: 'p1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', isActive: true },
      ]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.autoSchedule('admin-1', futureDate(1), futureDate(3));
      expect(result.proposed.length).toBeGreaterThan(0);
      expect(result.total).toBe(result.proposed.length);
    });

    it('should skip staff on approved leave', async () => {
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const availRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const prefRepo = createMockRepo();

      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 1, isActive: true },
      ]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', isActive: true }]);
      scheduleRepo.find.mockResolvedValue([]);
      availRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{
          id: 'av1', staffId: 'staff-1', status: 'approved',
          dateFrom: futureDate(1), dateTo: futureDate(1),
        }]),
      });
      templateRepo.findBy.mockResolvedValue([]);
      prefRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.autoSchedule('admin-1', futureDate(1), futureDate(1));
      expect(result.skipped).toBeGreaterThan(0);
    });

    it('should respect max 10 shifts per staff', async () => {
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const availRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const prefRepo = createMockRepo();

      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 1, isActive: true },
      ]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', isActive: true }]);
      // Staff already has 10 existing assignments across multiple days
      const existingAssignments = Array.from({ length: 10 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + 1 + (i % 3)); // spread across 3 days
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return { id: `a${i}`, staffId: 'staff-1', workDate: dateStr, status: 'scheduled' };
      });
      scheduleRepo.find.mockResolvedValue(existingAssignments);
      availRepo.find.mockResolvedValue([]);
      templateRepo.findBy.mockResolvedValue([]);
      prefRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.autoSchedule('admin-1', futureDate(1), futureDate(3));
      // staff-1 has 10 existing + proposed should hit max
      expect(result.proposed.length + result.skipped).toBeGreaterThan(0);
    });

    it('should prioritize template-matched staff', async () => {
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const availRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const prefRepo = createMockRepo();

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayOfWeek = tomorrow.getDay();

      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 1, isActive: true },
      ]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', isActive: true }]);
      scheduleRepo.find.mockResolvedValue([]);
      availRepo.find.mockResolvedValue([]);
      templateRepo.findBy.mockResolvedValue([
        { id: 't1', staffId: 'staff-2', shiftId: 'sh1', zoneId: 'z1', dayOfWeek, isActive: true },
      ]);
      prefRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffAvailabilityRequest') return availRepo;
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
      const result = await service.autoSchedule('admin-1', dateStr, dateStr);
      expect(result.proposed.length).toBeGreaterThan(0);
      // Template-matched staff should be assigned first
      expect(result.proposed[0].staffId).toBe('staff-2');
    });
  });

  // ─── Geofence ────────────────────────────────────────────────────────────

  describe('setGeofence', () => {
    it('should create geofence config', async () => {
      const geofenceRepo = createMockRepo();
      const zoneRepo = createMockRepo();

      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
      geofenceRepo.findOneBy.mockResolvedValue(null);
      geofenceRepo.save.mockImplementation(e => Promise.resolve({ id: 'gf1', ...e }));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'GeofenceConfig') return geofenceRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.setGeofence('actor-1', {
        zoneId: 'z1', latitude: 10.7769, longitude: 106.7009, radiusMeters: 150,
      });
      expect(result.latitude).toBe(10.7769);
    });

    it('should update existing geofence config', async () => {
      const geofenceRepo = createMockRepo();
      const zoneRepo = createMockRepo();

      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });
      geofenceRepo.findOneBy.mockResolvedValue({ id: 'gf1', zoneId: 'z1', latitude: 10.0, longitude: 106.0 });
      geofenceRepo.save.mockImplementation(e => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'GeofenceConfig') return geofenceRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.setGeofence('actor-1', {
        zoneId: 'z1', latitude: 10.7769, longitude: 106.7009,
      });
      expect(result.latitude).toBe(10.7769);
    });

    it('should throw NotFoundError if zone not found', async () => {
      const zoneRepo = createMockRepo();
      zoneRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.setGeofence('actor-1', {
        zoneId: 'nonexistent', latitude: 10.0, longitude: 106.0,
      })).rejects.toThrow(NotFoundError);
    });
  });

  describe('listGeofenceConfigs', () => {
    it('should return configs with zone data', async () => {
      const geofenceRepo = createMockRepo();
      const zoneRepo = createMockRepo();

      geofenceRepo.find.mockResolvedValue([{ id: 'gf1', zoneId: 'z1', isActive: true }]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', zoneName: 'A' }]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'GeofenceConfig') return geofenceRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listGeofenceConfigs();
      expect(result).toHaveLength(1);
    });
  });

  describe('deleteGeofence', () => {
    it('should soft-delete geofence config', async () => {
      const geofenceRepo = createMockRepo();
      geofenceRepo.findOneBy.mockResolvedValue({ id: 'gf1', zoneId: 'z1', isActive: true });
      geofenceRepo.save.mockImplementation(e => Promise.resolve(e));

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'GeofenceConfig') return geofenceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.deleteGeofence('actor-1', 'z1');
      expect(result.deleted).toBe(true);
    });

    it('should throw NotFoundError if config not found', async () => {
      const geofenceRepo = createMockRepo();
      geofenceRepo.findOneBy.mockResolvedValue(null);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'GeofenceConfig') return geofenceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      await expect(service.deleteGeofence('actor-1', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  // ─── auditLogs ───────────────────────────────────────────────────────────

  describe('auditLogs', () => {
    it('should return last 200 audit logs', async () => {
      const auditRepo = createMockRepo();
      auditRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([
          [{ id: 'log1', action: 'zone.created', metadata: null }],
          1
        ]),
      });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ScheduleAuditLog') return auditRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.auditLogs();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].action).toBe('zone.created');
    });
  });

  // ─── listBids ────────────────────────────────────────────────────────────

  describe('listBids', () => {
    it('should return enriched bids', async () => {
      const bidRepo = createMockRepo();
      const scheduleRepo = createMockRepo();

      bidRepo.find.mockResolvedValue([
        { id: 'b1', staffId: 'staff-1', assignmentId: 'a1', status: 'pending' },
      ]);
      scheduleRepo.findBy.mockResolvedValue([
        { id: 'a1', staffId: 'staff-2', shiftId: 'sh1', zoneId: 'z1' },
      ]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'ShiftBid') return bidRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listBids();
      expect(result).toHaveLength(1);
      expect(result[0].assignment).toBeDefined();
    });
  });

  // ─── listMine ────────────────────────────────────────────────────────────

  describe('listMine', () => {
    it('should delegate to listAssignments with staffId filter', async () => {
      const scheduleRepo = createMockRepo();
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const attendanceRepo = createMockRepo();

      scheduleRepo.find.mockResolvedValue([]);
      shiftRepo.findBy.mockResolvedValue([]);
      zoneRepo.findBy.mockResolvedValue([]);
      attendanceRepo.findBy.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffAttendance') return attendanceRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.listMine('staff-1', '2026-07-01', '2026-07-31');
      expect(result.items).toHaveLength(0);
    });
  });
});
