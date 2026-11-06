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
          get(_target, prop: string) {
            if (prop === 'getRepository') return getRepoFn;
            return function (...args: any[]) {
              const entity = args[0];
              const repo = entity ? getRepoFn(entity) : getRepoFn('StaffSchedule');
              const fn = repo[prop];
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

import { AppDataSource } from '../data-source';
import { ForbiddenError } from '../errors';
import { ScheduleService } from '../services/ScheduleService';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * BLF-ATT-01 — manual check-in approval must not be self-approved and must
 * enforce geofence server-side.
 */
describe('ScheduleService manual check-in approval (BLF-ATT-01)', () => {
  let service: ScheduleService;

  const geofenceInside = {
    zoneId: 'z1',
    latitude: 10.762622,
    longitude: 106.660172,
    radiusMeters: 100,
    isActive: true,
  };

  const geofenceOutside = {
    ...geofenceInside,
    radiusMeters: 10, // device ~1 km away -> outside
  };

  function mockReposForTest(attendance: any, schedule: any, geofence: any) {
    const attendanceRepo = createMockRepo();
    attendanceRepo.findOneBy.mockResolvedValue(attendance);
    attendanceRepo.save = jest.fn().mockResolvedValue(attendance);

    const scheduleRepo = createMockRepo();
    scheduleRepo.findOneBy.mockResolvedValue(schedule);
    scheduleRepo.save = jest.fn().mockResolvedValue(schedule);

    const geofenceRepo = createMockRepo();
    geofenceRepo.findOneBy.mockResolvedValue(geofence);

    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
      const name = entity?.name || String(entity);
      if (name === 'StaffAttendance') return attendanceRepo;
      if (name === 'StaffSchedule') return scheduleRepo;
      if (name === 'GeofenceConfig') return geofenceRepo;
      return createMockRepo();
    });

    service = new ScheduleService();
    return { attendanceRepo, scheduleRepo, geofenceRepo };
  }

  describe('self-approval is forbidden', () => {
    it('rejects when approverId === staffId', async () => {
      mockReposForTest(
        { id: 'att1', scheduleId: 'a1', staffId: 'staff-1', status: 'pending_manual' },
        { id: 'a1', staffId: 'staff-1', zoneId: 'z1', status: 'scheduled' },
        geofenceInside,
      );

      await expect(
        service.approveManualCheckIn('staff-1', 'att1'),
      ).rejects.toMatchObject({ name: 'ForbiddenError', message: 'SELF_APPROVAL_FORBIDDEN' });
    });
  });

  describe('approval by a different staff', () => {
    it('approves when inside the geofence', async () => {
      const { attendanceRepo } = mockReposForTest(
        { id: 'att1', scheduleId: 'a1', staffId: 'staff-1', status: 'pending_manual' },
        { id: 'a1', staffId: 'staff-1', zoneId: 'z1', status: 'scheduled' },
        geofenceInside,
      );

      const result = await service.approveManualCheckIn('admin-1', 'att1', {
        lat: 10.762622,
        lng: 106.660172,
      } as any);

      expect(result.status).toBe('completed');
      expect(attendanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'att1', status: 'completed' }),
      );
    });

    it('rejects when outside the geofence', async () => {
      mockReposForTest(
        { id: 'att1', scheduleId: 'a1', staffId: 'staff-1', status: 'pending_manual' },
        { id: 'a1', staffId: 'staff-1', zoneId: 'z1', status: 'scheduled' },
        geofenceOutside,
      );

      await expect(
        service.approveManualCheckIn('admin-1', 'att1', {
          lat: 11.0,
          lng: 107.0,
        } as any),
      ).rejects.toThrow();
    });
  });
});
