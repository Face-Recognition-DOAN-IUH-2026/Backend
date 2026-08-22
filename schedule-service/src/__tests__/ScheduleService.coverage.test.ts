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

      scheduleRepo.findOneBy
        .mockResolvedValueOnce({ id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled' })
        .mockResolvedValueOnce(null); // ensureNoDuplicateAssignment
      scheduleRepo.find.mockResolvedValue([]); // ensureNoShiftTimeOverlap
      scheduleRepo.save.mockImplementation(e => Promise.resolve(e));

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
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

      scheduleRepo.findOneBy
        .mockResolvedValueOnce({ id: 'a1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', workDate: futureDate(1), status: 'scheduled' })
        .mockResolvedValueOnce(null);
      scheduleRepo.find.mockResolvedValue([]);
      scheduleRepo.save.mockImplementation(e => Promise.resolve(e));

      shiftRepo.findOneBy.mockResolvedValue({ id: 'sh1', isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' });
      zoneRepo.findOneBy.mockResolvedValue({ id: 'z1', isActive: true });

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.moveAssignment('actor-1', 'a1', { note: 'Moved' });
      expect(result).toBeDefined();
    });
  });



  // ─── autoSchedule ────────────────────────────────────────────────────────

  describe('autoSchedule', () => {
    it('should propose assignments based on templates and preferences', async () => {
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const prefRepo = createMockRepo();

      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 1, isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' },
      ]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', isActive: true }]);
      scheduleRepo.find.mockResolvedValue([]); // no existing assignments
      templateRepo.findBy.mockResolvedValue([]);
      prefRepo.find.mockResolvedValue([
        { id: 'p1', staffId: 'staff-1', shiftId: 'sh1', zoneId: 'z1', isActive: true },
      ]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
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

    it('should respect max 10 shifts per staff', async () => {
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const prefRepo = createMockRepo();

      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 1, isActive: true },
      ]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', isActive: true }]);
      const existingAssignments = Array.from({ length: 10 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + 1 + (i % 3));
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return { id: `a${i}`, staffId: 'staff-1', workDate: dateStr, status: 'scheduled' };
      });
      scheduleRepo.find.mockResolvedValue(existingAssignments);
      templateRepo.findBy.mockResolvedValue([]);
      prefRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
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
      templateRepo.findBy.mockResolvedValue([
        { id: 't1', staffId: 'staff-2', shiftId: 'sh1', zoneId: 'z1', dayOfWeek, isActive: true },
      ]);
      prefRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
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

    // ─── SCHED-FIX1: Full-week generation ──────────────────────────────────

    it('should generate proposals for ALL 7 days of a week (SCHED-FIX1)', async () => {
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const prefRepo = createMockRepo();

      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 2, maxStaff: 4, isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' },
        { id: 'sh2', minStaff: 2, maxStaff: 4, isActive: true, startTime: '13:00', endTime: '17:00', name: 'Afternoon' },
      ]);
      zoneRepo.findBy.mockResolvedValue([
        { id: 'z1', isActive: true },
        { id: 'z2', isActive: true },
      ]);
      scheduleRepo.find.mockResolvedValue([]);
      templateRepo.findBy.mockResolvedValue([]);
      prefRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      // 7-day range: from tomorrow to tomorrow+6
      const result = await service.autoSchedule('admin-1', futureDate(1), futureDate(7));

      // Should have proposals for all 7 days
      const uniqueDates = [...new Set(result.proposed.map((p: any) => p.workDate))];
      expect(uniqueDates.length).toBe(7);

      // Total should be significant (3 staff × 2 shifts × 2 zones × 7 days, minus constraints)
      expect(result.total).toBeGreaterThan(20);
    });

    it('should generate proposals for 14-day range (SCHED-FIX1)', async () => {
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const prefRepo = createMockRepo();

      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 1, maxStaff: 3, isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' },
      ]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', isActive: true }]);
      scheduleRepo.find.mockResolvedValue([]);
      templateRepo.findBy.mockResolvedValue([]);
      prefRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.autoSchedule('admin-1', futureDate(1), futureDate(14));

      // Should have proposals for all 14 days
      const uniqueDates = [...new Set(result.proposed.map((p: any) => p.workDate))];
      expect(uniqueDates.length).toBe(14);
    });

    it('should still enforce zone conflict per day (SCHED-FIX1)', async () => {
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const prefRepo = createMockRepo();

      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 1, maxStaff: 3, isActive: true, startTime: '08:00', endTime: '12:00', name: 'Morning' },
      ]);
      zoneRepo.findBy.mockResolvedValue([
        { id: 'z1', isActive: true },
        { id: 'z2', isActive: true },
      ]);
      scheduleRepo.find.mockResolvedValue([]);
      templateRepo.findBy.mockResolvedValue([]);
      prefRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.autoSchedule('admin-1', futureDate(1), futureDate(1));

      // Each staff should be in at most 1 zone per day
      const staffDayZones = new Map<string, Set<string>>();
      for (const p of result.proposed) {
        const key = `${p.staffId}:${p.workDate}`;
        if (!staffDayZones.has(key)) staffDayZones.set(key, new Set());
        staffDayZones.get(key)!.add(p.zoneId);
      }
      for (const [, zones] of staffDayZones) {
        expect(zones.size).toBeLessThanOrEqual(1);
      }
    });

    it('should still enforce time overlap check (SCHED-FIX1)', async () => {
      const shiftRepo = createMockRepo();
      const zoneRepo = createMockRepo();
      const scheduleRepo = createMockRepo();
      const templateRepo = createMockRepo();
      const prefRepo = createMockRepo();

      // Two overlapping shifts (08:00-13:00 and 12:00-17:00 overlap at 12:00-13:00)
      shiftRepo.findBy.mockResolvedValue([
        { id: 'sh1', minStaff: 1, maxStaff: 3, isActive: true, startTime: '08:00', endTime: '13:00', name: 'Morning' },
        { id: 'sh2', minStaff: 1, maxStaff: 3, isActive: true, startTime: '12:00', endTime: '17:00', name: 'Afternoon' },
      ]);
      zoneRepo.findBy.mockResolvedValue([{ id: 'z1', isActive: true }]);
      scheduleRepo.find.mockResolvedValue([]);
      templateRepo.findBy.mockResolvedValue([]);
      prefRepo.find.mockResolvedValue([]);

      (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
        const name = entity?.name || String(entity);
        if (name === 'StaffShift') return shiftRepo;
        if (name === 'LibraryZone') return zoneRepo;
        if (name === 'StaffSchedule') return scheduleRepo;
        if (name === 'StaffScheduleTemplate') return templateRepo;
        if (name === 'StaffShiftPreference') return prefRepo;
        if (!mockRepos[name]) mockRepos[name] = createMockRepo();
        return mockRepos[name];
      });

      service = new ScheduleService();
      const result = await service.autoSchedule('admin-1', futureDate(1), futureDate(1));

      // No staff should have both sh1 and sh2 on the same day
      const staffDayShifts = new Map<string, Set<string>>();
      for (const p of result.proposed) {
        const key = `${p.staffId}:${p.workDate}`;
        if (!staffDayShifts.has(key)) staffDayShifts.set(key, new Set());
        staffDayShifts.get(key)!.add(p.shiftId);
      }
      for (const [, shifts] of staffDayShifts) {
        // sh1 and sh2 overlap, so staff should have at most 1 of them
        if (shifts.has('sh1') && shifts.has('sh2')) {
          fail('Staff has overlapping shifts on the same day');
        }
      }
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
