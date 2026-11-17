const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  smembers: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
};

const mockDbQuery = jest.fn();
const mockDataSource = {
  isInitialized: true,
  query: (...args: any[]) => mockDbQuery(...args),
};

jest.mock('../../redis', () => ({
  redis: mockRedis,
}));

jest.mock('../../data-source', () => ({
  AppDataSource: mockDataSource,
}));

import { PermissionService } from '../../services/PermissionService';
import { DEFAULT_ROLE_CONFIGS } from '../../../../shared/auth/permissions';

describe('PermissionService - Dynamic RBAC Lifecycle & Persistence', () => {
  let service: PermissionService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDataSource.isInitialized = true;
    mockDbQuery.mockResolvedValue([]);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.smembers.mockResolvedValue([]);
    mockRedis.sadd.mockResolvedValue(1);
    mockRedis.srem.mockResolvedValue(1);
    service = new PermissionService();
  });

  it('persists custom role to PostgreSQL and writes through to Redis', async () => {
    const customConfig = {
      ...DEFAULT_ROLE_CONFIGS.staff,
      role: 'Cataloger',
      label: 'Biên mục viên',
      allowedPages: ['/dashboard', '/books', '/knowledge-base'],
    };

    const saved = await service.updateRoleConfig('Cataloger', customConfig);

    expect(saved.role).toBe('cataloger');
    // DDL ensured tables + INSERT upsert executed
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO rbac_role_configs'), [
      'cataloger',
      expect.any(String),
      true,
    ]);
    expect(mockRedis.set).toHaveBeenCalledWith('rbac:role:cataloger', expect.any(String));
    expect(mockRedis.sadd).toHaveBeenCalledWith('rbac:custom_roles', 'cataloger');
  });

  it('rejects modifying the root admin role config', async () => {
    await expect(service.updateRoleConfig('admin', DEFAULT_ROLE_CONFIGS.admin)).rejects.toThrow(
      'Admin',
    );
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('warms Redis from PostgreSQL when Redis cache misses on getRoleConfig', async () => {
    const dbCfg = {
      ...DEFAULT_ROLE_CONFIGS.staff,
      role: 'circulation',
      label: 'Thủ thư lưu hành',
    };
    mockRedis.get.mockResolvedValueOnce(null);
    mockDbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT config FROM rbac_role_configs')) {
        return [{ config: dbCfg }];
      }
      return [];
    });

    const loaded = await service.getRoleConfig('circulation');

    expect(loaded).toEqual(dbCfg);
    expect(mockRedis.set).toHaveBeenCalledWith('rbac:role:circulation', JSON.stringify(dbCfg));
  });

  it('validates both system roles and persisted custom roles', async () => {
    mockRedis.smembers.mockResolvedValueOnce(['cataloger']);

    expect(await service.isValidRole('staff')).toBe(true);
    expect(await service.isValidRole('cataloger')).toBe(true);
    expect(await service.isValidRole('unknown_xyz')).toBe(false);
  });

  it('prevents deleting built-in roles and roles still assigned to active users', async () => {
    await expect(service.deleteRoleConfig('staff')).rejects.toThrow('mặc định');

    mockDbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT COUNT(*)')) return [{ cnt: 2 }];
      return [];
    });

    await expect(service.deleteRoleConfig('cataloger')).rejects.toThrow('2 tài khoản');
  });

  it('deletes unused custom role from both PostgreSQL and Redis', async () => {
    mockDbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT COUNT(*)')) return [{ cnt: 0 }];
      return [];
    });

    const res = await service.deleteRoleConfig('cataloger');

    expect(res).toEqual({ deleted: true, role: 'cataloger' });
    expect(mockDbQuery).toHaveBeenCalledWith('DELETE FROM rbac_role_configs WHERE role = $1', ['cataloger']);
    expect(mockRedis.del).toHaveBeenCalledWith('rbac:role:cataloger');
    expect(mockRedis.srem).toHaveBeenCalledWith('rbac:custom_roles', 'cataloger');
  });

  it('computes effective permissions combining role baseline and user overrides', async () => {
    const customRoleCfg = {
      ...DEFAULT_ROLE_CONFIGS.staff,
      role: 'cataloger',
      allowedPages: ['/dashboard', '/books'],
    };
    mockRedis.get
      .mockResolvedValueOnce(JSON.stringify(customRoleCfg))
      .mockResolvedValueOnce(
        JSON.stringify({
          enabled: true,
          grantedPages: ['/settings'],
          revokedPages: ['/dashboard'],
          grantedCrud: { settings: { read: true, update: true } },
          revokedCrud: { books: { update: true } },
        }),
      );

    const effective = await service.getEffectivePermissions('user-99', 'cataloger');

    expect(effective.isCustom).toBe(true);
    expect(effective.allowedPages).toEqual(['/books', '/settings']);
    expect(effective.crud.settings.read).toBe(true);
    expect(effective.crud.settings.update).toBe(true);
    expect(effective.crud.books.update).toBe(false);
  });
});
