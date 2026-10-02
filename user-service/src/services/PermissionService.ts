import { redis } from '../redis';
import {
  RolePermissionConfig,
  UserPermissionOverride,
  EffectivePermissions,
  DEFAULT_ROLE_CONFIGS,
  resolveEffectivePermissions,
  ALL_ROUTES,
  ALL_RESOURCES,
} from '../../../shared/auth/permissions';

const REDIS_ROLE_KEY_PREFIX = 'rbac:role:';
const REDIS_USER_OVERRIDE_KEY_PREFIX = 'rbac:user:';
const REDIS_CUSTOM_ROLES_KEY = 'rbac:custom_roles';

export class PermissionService {
  /**
   * Retrieves permission configuration for all roles (built-in + custom)
   */
  async getAllRoleConfigs(): Promise<Record<string, RolePermissionConfig>> {
    const roles = ['admin', 'staff', 'patron'];

    // Check custom roles list in Redis
    try {
      const customRoles = await redis.smembers(REDIS_CUSTOM_ROLES_KEY);
      if (customRoles && customRoles.length > 0) {
        customRoles.forEach((r) => {
          if (!roles.includes(r)) roles.push(r);
        });
      }
    } catch (err: any) {
      console.warn('[PermissionService] Failed to fetch custom roles list from Redis:', err.message);
    }

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
    const normalizedRole = (role || 'patron').toLowerCase();

    try {
      const raw = await redis.get(`${REDIS_ROLE_KEY_PREFIX}${normalizedRole}`);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (err: any) {
      console.warn(`[PermissionService] Redis error getting role ${normalizedRole}:`, err.message);
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
        books: { create: false, read: true, update: false, delete: false },
        patrons: { create: false, read: false, update: false, delete: false },
        borrows: { create: false, read: false, update: false, delete: false },
        schedules: { create: false, read: false, update: false, delete: false },
        ai_tools: { create: false, read: true, update: false, delete: false },
        settings: { create: false, read: false, update: false, delete: false },
        stats: { create: false, read: false, update: false, delete: false },
      },
    };
  }

  /**
   * Updates configuration for a role
   */
  async updateRoleConfig(role: string, config: RolePermissionConfig): Promise<RolePermissionConfig> {
    const normalizedRole = (role || 'patron').toLowerCase();
    const updatedConfig: RolePermissionConfig = {
      ...config,
      role: normalizedRole,
    };

    try {
      await redis.set(`${REDIS_ROLE_KEY_PREFIX}${normalizedRole}`, JSON.stringify(updatedConfig));
      if (!['admin', 'staff', 'patron'].includes(normalizedRole)) {
        await redis.sadd(REDIS_CUSTOM_ROLES_KEY, normalizedRole);
      }
    } catch (err: any) {
      console.error(`[PermissionService] Failed to save role config in Redis:`, err.message);
      throw new Error(`Không thể lưu cấu hình quyền cho vai trò ${role}`);
    }

    return updatedConfig;
  }

  /**
   * Retrieves user-specific permission override
   */
  async getUserOverride(userId: string): Promise<UserPermissionOverride | null> {
    try {
      const raw = await redis.get(`${REDIS_USER_OVERRIDE_KEY_PREFIX}${userId}`);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (err: any) {
      console.warn(`[PermissionService] Redis error getting user override for ${userId}:`, err.message);
    }

    return null;
  }

  /**
   * Saves or clears user-specific permission override
   */
  async updateUserOverride(
    userId: string,
    override: UserPermissionOverride
  ): Promise<UserPermissionOverride> {
    try {
      if (!override || override.enabled === false) {
        await redis.del(`${REDIS_USER_OVERRIDE_KEY_PREFIX}${userId}`);
        return {
          enabled: false,
          grantedPages: [],
          revokedPages: [],
          grantedCrud: {},
          revokedCrud: {},
        };
      }

      await redis.set(
        `${REDIS_USER_OVERRIDE_KEY_PREFIX}${userId}`,
        JSON.stringify(override)
      );
      return override;
    } catch (err: any) {
      console.error(`[PermissionService] Failed to save user override for ${userId}:`, err.message);
      throw new Error(`Không thể lưu cấu hình quyền riêng cho người dùng ${userId}`);
    }
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
