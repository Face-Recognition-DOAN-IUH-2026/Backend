const mockGet = jest.fn();

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
  get: (...args: any[]) => mockGet(...args),
  on: jest.fn(),
})), { virtual: true });

import type { Response } from 'express';

function loadPermissions() {
  let mod: any;
  jest.isolateModules(() => {
    mod = require('../auth/permissions');
  });
  return mod;
}

function mockRes() {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

function buildReq(overrides?: Record<string, any>) {
  return { user: { id: 'u1', role: 'staff' }, ...overrides } as any;
}

describe('requireDynamicPermission fail-closed behavior', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('DENIES when Redis lookup fails (fail-closed instead of baseline fallback)', async () => {
    const { requireDynamicPermission } = loadPermissions();
    mockGet.mockRejectedValue(new Error('Redis down'));

    const res = mockRes();
    let nextCalled = false;

    await requireDynamicPermission('schedules', 'read')(buildReq(), res as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('DENIES when override resolution option throws', async () => {
    const { requireDynamicPermission } = loadPermissions();

    const res = mockRes();
    let nextCalled = false;

    await requireDynamicPermission('schedules', 'read', {
      getEffectivePerms: async () => { throw new Error('override store down'); },
    })(buildReq(), res as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('DENIES when no permission source is available (no userId, no option)', async () => {
    const { requireDynamicPermission } = loadPermissions();

    const res = mockRes();
    let nextCalled = false;

    await requireDynamicPermission('schedules', 'read')(buildReq({ user: { role: 'staff' } }), res as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('APPLIES role baseline when Redis is healthy and has no overrides', async () => {
    const { requireDynamicPermission } = loadPermissions();
    mockGet.mockResolvedValue(null);

    const res = mockRes();
    let nextCalled = false;

    // staff has schedules:read = true in baseline
    await requireDynamicPermission('schedules', 'read')(buildReq(), res as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('APPLIES stored overrides when Redis is healthy (revoke wins over baseline)', async () => {
    const { requireDynamicPermission } = loadPermissions();
    // baseline staff has schedules:read=true; override revokes it
    mockGet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify({
        enabled: true,
        grantedPages: [],
        revokedPages: [],
        grantedCrud: {},
        revokedCrud: { schedules: { read: true } },
      }));

    const res = mockRes();
    let nextCalled = false;

    await requireDynamicPermission('schedules', 'read')(buildReq(), res as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('still allows admin without touching Redis', async () => {
    const { requireDynamicPermission } = loadPermissions();

    const res = mockRes();
    let nextCalled = false;

    await requireDynamicPermission('schedules', 'delete')(buildReq({ user: { id: 'a1', role: 'admin' } }), res as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('includes /knowledge-base in ALL_ROUTES and allows custom staff roles through requireRole(["admin", "staff"])', () => {
    const { ALL_ROUTES } = loadPermissions();
    const { requireRole } = require('../auth/requireRole');

    expect(ALL_ROUTES.some((r: any) => r.path === '/knowledge-base')).toBe(true);

    const customRes = mockRes();
    let customNext = false;
    requireRole(['admin', 'staff'])(buildReq({ user: { id: 'u2', role: 'cataloger' } }), customRes as Response, () => { customNext = true; });
    expect(customNext).toBe(true);

    const patronRes = mockRes();
    let patronNext = false;
    requireRole(['admin', 'staff'])(buildReq({ user: { id: 'u3', role: 'patron' } }), patronRes as Response, () => { patronNext = true; });
    expect(patronNext).toBe(false);
    expect(patronRes.status).toHaveBeenCalledWith(403);
  });
});
