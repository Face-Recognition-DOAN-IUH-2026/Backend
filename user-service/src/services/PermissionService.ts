import { redis } from '../redis';
import {
  RolePermissionConfig,
  UserPermissionOverride,
  EffectivePermissions,
  DEFAULT_ROLE_CONFIGS,
  resolveEffectivePermissions,
} from '../../../shared/auth/permissions';

const REDIS_ROLE_KEY_PREFIX = 'rbac:role:';
const REDIS_USER_OVERRIDE_KEY_PREFIX = 'rbac:user:';
const REDIS_CUSTOM_ROLES_KEY = 'rbac:custom_roles';
const SYSTEM_ROLES = new Set(['admin', 'staff', 'patron', 'user']);
const CORE_MATRIX_ROLES = ['admin', 'staff', 'patron'];

function defaultResourceCrud(readOnly = false) {
  return {
    create: false,
    read: readOnly,
    update: false,
    delete: false,
    approve: false,
    print: false,
  };
}

export class PermissionService {
  private tablesEnsured = false;

  private getDataSource(): { isInitialized?: boolean; query: (sql: string, params?: any[]) => Promise<any> } | null {
    try {
      const mod = require('../data-source');
      return mod?.AppDataSource ?? null;
    } catch {
      return null;
    }
  }

  private isRedisUsable(): boolean {
    if (!redis) return false;
    const status = (redis as any).status;
    // Mocked clients in tests have no `.status`; real ioredis clients expose `.status`.
    if (typeof status === 'string') {
      return status === 'ready' || status === 'connect';
    }
    return true;
  }

  private async ensureTables(): Promise<boolean> {
    const ds = this.getDataSource();
    if (!ds || !ds.isInitialized) {
      return false;
    }
    if (this.tablesEnsured) {
      return true;
    }
    try {
      await ds.query(`
        CREATE TABLE IF NOT EXISTS rbac_role_configs (
          role VARCHAR(64) PRIMARY KEY,
          config JSONB NOT NULL,
          is_custom BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await ds.query(`
        CREATE TABLE IF NOT EXISTS rbac_user_overrides (
          user_id VARCHAR(64) PRIMARY KEY,
          override JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      this.tablesEnsured = true;
      return true;
    } catch (err: any) {
      console.warn('[PermissionService] Failed to ensure RBAC tables:', err?.message || err);
      return false;
    }
  }

  async getCustomRoleKeys(): Promise<string[]> {
    const found = new Set<string>();

    if (this.isRedisUsable()) {
      try {
        const customRoles = await redis.smembers(REDIS_CUSTOM_ROLES_KEY);
        if (Array.isArray(customRoles)) {
          customRoles.forEach((r) => {
            const norm = (r || '').trim().toLowerCase();
            if (norm && !CORE_MATRIX_ROLES.includes(norm)) {
              found.add(norm);
            }
          });
        }
      } catch (err: any) {
        console.warn('[PermissionService] Failed to fetch custom roles list from Redis:', err?.message);
      }
    }

    if (await this.ensureTables()) {
      try {
        const ds = this.getDataSource()!;
        const rows = await ds.query('SELECT role FROM rbac_role_configs WHERE is_custom = TRUE');
        if (Array.isArray(rows)) {
          const toWarm: string[] = [];
          rows.forEach((row: any) => {
            const norm = (row?.role || '').trim().toLowerCase();
            if (norm && !CORE_MATRIX_ROLES.includes(norm)) {
              if (!found.has(norm)) toWarm.push(norm);
              found.add(norm);
            }
          });
          if (toWarm.length > 0 && this.isRedisUsable()) {
            await redis.sadd(REDIS_CUSTOM_ROLES_KEY, ...toWarm).catch(() => {});
          }
        }
      } catch (err: any) {
        console.warn('[PermissionService] Failed to fetch custom roles list from PostgreSQL:', err?.message);
      }
    }

    return Array.from(found);
  }

  async isValidRole(role: string): Promise<boolean> {
    const normalized = (role || '').trim().toLowerCase();
    if (!normalized) return false;
    if (SYSTEM_ROLES.has(normalized)) return true;
    const customRoles = await this.getCustomRoleKeys();
    return customRoles.includes(normalized);
  }

  /**
   * Retrieves permission configuration for all roles (built-in + custom)
   */
  async getAllRoleConfigs(): Promise<Record<string, RolePermissionConfig>> {
    const roles = [...CORE_MATRIX_ROLES];
    const customRoles = await this.getCustomRoleKeys();
    customRoles.forEach((r) => {
      if (!roles.includes(r)) roles.push(r);
    });

    const configs: Record<string, RolePermissionConfig> = {};
    for (const role of roles) {
      configs[role] = await this.getRoleConfig(role);
    }

    return configs;
  }

  /**
   * Retrieves configuration for a single role
   */
  async getRoleConfig(role: string): Promise<RolePermissionConfig> {
    const normalizedRole = (role || 'patron').trim().toLowerCase();

    if (this.isRedisUsable()) {
      try {
        const raw = await redis.get(`${REDIS_ROLE_KEY_PREFIX}${normalizedRole}`);
        if (raw) {
          return JSON.parse(raw);
        }
      } catch (err: any) {
        console.warn(`[PermissionService] Redis error getting role ${normalizedRole}:`, err?.message);
      }
    }

    if (await this.ensureTables()) {
      try {
        const ds = this.getDataSource()!;
        const rows = await ds.query(
          'SELECT config FROM rbac_role_configs WHERE role = $1 LIMIT 1',
          [normalizedRole],
        );
        if (Array.isArray(rows) && rows.length > 0 && rows[0]?.config) {
          const cfg = typeof rows[0].config === 'string' ? JSON.parse(rows[0].config) : rows[0].config;
          if (this.isRedisUsable()) {
            await redis.set(`${REDIS_ROLE_KEY_PREFIX}${normalizedRole}`, JSON.stringify(cfg)).catch(() => {});
          }
          return cfg;
        }
      } catch (err: any) {
        console.warn(`[PermissionService] DB error getting role ${normalizedRole}:`, err?.message);
      }
    }

    // Fallback to defaults
    if (DEFAULT_ROLE_CONFIGS[normalizedRole]) {
      return DEFAULT_ROLE_CONFIGS[normalizedRole];
    }

    // Default template for a newly added custom role
    return {
      role: normalizedRole,
      label: normalizedRole.toUpperCase(),
      description: 'Vai trò tùy chỉnh',
      allowedPages: ['/dashboard', '/books'],
      crud: {
        books: defaultResourceCrud(true),
        patrons: defaultResourceCrud(false),
        borrows: defaultResourceCrud(false),
        schedules: defaultResourceCrud(false),
        ai_tools: defaultResourceCrud(true),
        settings: defaultResourceCrud(false),
        stats: defaultResourceCrud(false),
      },
    };
  }

  /**
   * Updates configuration for a role (PostgreSQL + write-through Redis)
   */
  async updateRoleConfig(role: string, config: RolePermissionConfig): Promise<RolePermissionConfig> {
    const normalizedRole = (role || 'patron').trim().toLowerCase();
    if (!normalizedRole) {
      throw new Error('Mã vai trò không được để trống');
    }
    if (normalizedRole === 'admin') {
      throw new Error('Không thể thay đổi cấu hình quyền gốc của Admin');
    }

    const updatedConfig: RolePermissionConfig = {
      ...config,
      role: normalizedRole,
    };
    const isCustom = !CORE_MATRIX_ROLES.includes(normalizedRole) && normalizedRole !== 'user';
    const hasDb = await this.ensureTables();

    if (hasDb) {
      try {
        const ds = this.getDataSource()!;
        await ds.query(
          `INSERT INTO rbac_role_configs (role, config, is_custom, updated_at)
           VALUES ($1, $2::jsonb, $3, NOW())
           ON CONFLICT (role) DO UPDATE
             SET config = EXCLUDED.config,
                 is_custom = EXCLUDED.is_custom,
                 updated_at = NOW()`,
          [normalizedRole, JSON.stringify(updatedConfig), isCustom],
        );
      } catch (err: any) {
        console.error(`[PermissionService] Failed to save role config in PostgreSQL:`, err?.message);
        throw new Error(`Không thể lưu cấu hình quyền cho vai trò ${role}`);
      }
    }

    if (this.isRedisUsable()) {
      try {
        await redis.set(`${REDIS_ROLE_KEY_PREFIX}${normalizedRole}`, JSON.stringify(updatedConfig));
        if (isCustom) {
          await redis.sadd(REDIS_CUSTOM_ROLES_KEY, normalizedRole);
        }
      } catch (err: any) {
        console.error(`[PermissionService] Failed to save role config in Redis:`, err?.message);
        if (!hasDb) {
          throw new Error(`Không thể lưu cấu hình quyền cho vai trò ${role}`);
        }
      }
    } else if (!hasDb) {
      throw new Error(`Không thể lưu cấu hình quyền cho vai trò ${role}`);
    }

    return updatedConfig;
  }

  /**
   * Deletes a custom role configuration (checks active users first)
   */
  async deleteRoleConfig(role: string): Promise<{ deleted: boolean; role: string }> {
    const normalizedRole = (role || '').trim().toLowerCase();
    if (!normalizedRole) {
      throw new Error('Mã vai trò không hợp lệ');
    }
    if (SYSTEM_ROLES.has(normalizedRole)) {
      throw new Error(`Không thể xóa vai trò mặc định của hệ thống (${normalizedRole})`);
    }

    const hasDb = await this.ensureTables();
    if (hasDb) {
      const ds = this.getDataSource()!;
      const countRows = await ds.query(
        `SELECT COUNT(*)::int AS cnt FROM users WHERE role = $1 AND status != 'deleted'`,
        [normalizedRole],
      );
      const cnt = Number(countRows?.[0]?.cnt || 0);
      if (cnt > 0) {
        throw new Error(`Không thể xóa vai trò "${normalizedRole}" vì đang có ${cnt} tài khoản sử dụng vai trò này`);
      }
      await ds.query('DELETE FROM rbac_role_configs WHERE role = $1', [normalizedRole]);
    }

    if (this.isRedisUsable()) {
      try {
        await redis.del(`${REDIS_ROLE_KEY_PREFIX}${normalizedRole}`);
        await redis.srem(REDIS_CUSTOM_ROLES_KEY, normalizedRole);
      } catch (err: any) {
        console.warn(`[PermissionService] Failed to remove role ${normalizedRole} from Redis:`, err?.message);
      }
    }

    return { deleted: true, role: normalizedRole };
  }

  /**
   * Retrieves user-specific permission override (Redis -> PostgreSQL fallback)
   */
  async getUserOverride(userId: string): Promise<UserPermissionOverride | null> {
    if (this.isRedisUsable()) {
      try {
        const raw = await redis.get(`${REDIS_USER_OVERRIDE_KEY_PREFIX}${userId}`);
        if (raw) {
          return JSON.parse(raw);
        }
      } catch (err: any) {
        console.warn(`[PermissionService] Redis error getting user override for ${userId}:`, err?.message);
      }
    }

    if (await this.ensureTables()) {
      try {
        const ds = this.getDataSource()!;
        const rows = await ds.query(
          'SELECT override FROM rbac_user_overrides WHERE user_id = $1 LIMIT 1',
          [userId],
        );
        if (Array.isArray(rows) && rows.length > 0 && rows[0]?.override) {
          const parsed = typeof rows[0].override === 'string' ? JSON.parse(rows[0].override) : rows[0].override;
          if (this.isRedisUsable()) {
            await redis.set(`${REDIS_USER_OVERRIDE_KEY_PREFIX}${userId}`, JSON.stringify(parsed)).catch(() => {});
          }
          return parsed;
        }
      } catch (err: any) {
        console.warn(`[PermissionService] DB error getting user override for ${userId}:`, err?.message);
      }
    }

    return null;
  }

  /**
   * Saves or clears user-specific permission override (PostgreSQL + write-through Redis)
   */
  async updateUserOverride(
    userId: string,
    override: UserPermissionOverride
  ): Promise<UserPermissionOverride> {
    const isDisabled = !override || override.enabled === false;
    const hasDb = await this.ensureTables();

    if (hasDb) {
      try {
        const ds = this.getDataSource()!;
        if (isDisabled) {
          await ds.query('DELETE FROM rbac_user_overrides WHERE user_id = $1', [userId]);
        } else {
          await ds.query(
            `INSERT INTO rbac_user_overrides (user_id, override, updated_at)
             VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (user_id) DO UPDATE
               SET override = EXCLUDED.override,
                   updated_at = NOW()`,
            [userId, JSON.stringify(override)],
          );
        }
      } catch (err: any) {
        console.error(`[PermissionService] Failed to save user override in DB for ${userId}:`, err?.message);
        throw new Error(`Không thể lưu cấu hình quyền riêng cho người dùng ${userId}`);
      }
    }

    if (this.isRedisUsable()) {
      try {
        if (isDisabled) {
          await redis.del(`${REDIS_USER_OVERRIDE_KEY_PREFIX}${userId}`);
        } else {
          await redis.set(
            `${REDIS_USER_OVERRIDE_KEY_PREFIX}${userId}`,
            JSON.stringify(override)
          );
        }
      } catch (err: any) {
        console.error(`[PermissionService] Failed to save user override in Redis for ${userId}:`, err?.message);
        if (!hasDb) {
          throw new Error(`Không thể lưu cấu hình quyền riêng cho người dùng ${userId}`);
        }
      }
    } else if (!hasDb) {
      throw new Error(`Không thể lưu cấu hình quyền riêng cho người dùng ${userId}`);
    }

    if (isDisabled) {
      return {
        enabled: false,
        grantedPages: [],
        revokedPages: [],
        grantedCrud: {},
        revokedCrud: {},
      };
    }

    return override;
  }

  /**
   * Computes effective permissions for a user given their ID and base role
   */
  async getEffectivePermissions(userId: string, role: string): Promise<EffectivePermissions> {
    const roleConfig = await this.getRoleConfig(role);
    const userOverride = await this.getUserOverride(userId);
    return resolveEffectivePermissions(role, roleConfig, userOverride);
  }
}

export const permissionService = new PermissionService();
