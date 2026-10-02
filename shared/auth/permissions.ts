import { Response, NextFunction } from 'express';
import { AuthRequest } from './types';

export type SystemResource =
  | 'books'
  | 'patrons'
  | 'borrows'
  | 'schedules'
  | 'ai_tools'
  | 'settings'
  | 'stats';

export type CrudAction = 'create' | 'read' | 'update' | 'delete';

export const ALL_RESOURCES: SystemResource[] = [
  'books',
  'patrons',
  'borrows',
  'schedules',
  'ai_tools',
  'settings',
  'stats',
];

export const ALL_ACTIONS: CrudAction[] = ['create', 'read', 'update', 'delete'];

export interface ResourceCrudPermission {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
}

export interface RolePermissionConfig {
  role: string;
  label: string;
  description?: string;
  allowedPages: string[];
  crud: Record<SystemResource, ResourceCrudPermission>;
}

export interface UserPermissionOverride {
  enabled: boolean;
  grantedPages: string[];
  revokedPages: string[];
  grantedCrud: Partial<Record<SystemResource, Partial<ResourceCrudPermission>>>;
  revokedCrud: Partial<Record<SystemResource, Partial<ResourceCrudPermission>>>;
}

export interface EffectivePermissions {
  role: string;
  isCustom: boolean;
  allowedPages: string[];
  crud: Record<SystemResource, ResourceCrudPermission>;
}

export const ALL_ROUTES = [
  { path: '/dashboard', label: 'Tổng quan' },
  { path: '/books', label: 'Kho sách' },
  { path: '/patrons', label: 'Độc giả' },
  { path: '/borrow', label: 'Mượn sách' },
  { path: '/return', label: 'Trả sách' },
  { path: '/gate', label: 'Cổng ra vào' },
  { path: '/history', label: 'Lịch sử' },
  { path: '/staff-schedules', label: 'Lịch trực' },
  { path: '/ai-assistant', label: 'Trợ lý AI' },
  { path: '/enroll', label: 'Đăng ký khuôn mặt' },
  { path: '/dynamic-admin', label: 'Quản trị phân quyền' },
  { path: '/settings', label: 'Cài đặt' },
  { path: '/stats', label: 'Thống kê' },
];

function fullCrud(enabled: boolean): ResourceCrudPermission {
  return { create: enabled, read: enabled, update: enabled, delete: enabled };
}

export const DEFAULT_ROLE_CONFIGS: Record<string, RolePermissionConfig> = {
  admin: {
    role: 'admin',
    label: 'Quản trị viên (Admin)',
    description: 'Toàn quyền truy cập mọi trang và thực hiện mọi thao tác CRUD',
    allowedPages: ALL_ROUTES.map((r) => r.path),
    crud: {
      books: fullCrud(true),
      patrons: fullCrud(true),
      borrows: fullCrud(true),
      schedules: fullCrud(true),
      ai_tools: fullCrud(true),
      settings: fullCrud(true),
      stats: fullCrud(true),
    },
  },
  staff: {
    role: 'staff',
    label: 'Thủ thư / Nhân viên',
    description: 'Quản lý mượn trả, độc giả, kho sách; không được xóa sách/cấu hình',
    allowedPages: [
      '/dashboard',
      '/books',
      '/patrons',
      '/borrow',
      '/return',
      '/gate',
      '/history',
      '/staff-schedules',
      '/ai-assistant',
      '/enroll',
      '/stats',
    ],
    crud: {
      books: { create: true, read: true, update: true, delete: false },
      patrons: { create: true, read: true, update: true, delete: false },
      borrows: { create: true, read: true, update: true, delete: false },
      schedules: { create: false, read: true, update: false, delete: false },
      ai_tools: { create: true, read: true, update: true, delete: false },
      settings: fullCrud(false),
      stats: { create: false, read: true, update: false, delete: false },
    },
  },
  patron: {
    role: 'patron',
    label: 'Bạn đọc (Sinh viên/Giảng viên)',
    description: 'Chỉ xem sách, mượn sách trực tuyến và dùng trợ lý AI',
    allowedPages: ['/dashboard', '/books', '/borrow', '/ai-assistant'],
    crud: {
      books: { create: false, read: true, update: false, delete: false },
      patrons: fullCrud(false),
      borrows: { create: true, read: true, update: false, delete: false },
      schedules: fullCrud(false),
      ai_tools: { create: true, read: true, update: false, delete: false },
      settings: fullCrud(false),
      stats: fullCrud(false),
    },
  },
};

/**
 * Resolves effective permissions by applying User Overrides on top of Role baseline
 */
export function resolveEffectivePermissions(
  role: string,
  roleConfigInput?: RolePermissionConfig,
  override?: UserPermissionOverride | null
): EffectivePermissions {
  const normalizedRole = (role || 'patron').toLowerCase();
  const baseConfig =
    roleConfigInput ||
    DEFAULT_ROLE_CONFIGS[normalizedRole] ||
    DEFAULT_ROLE_CONFIGS['patron'];

  // Admin bypass
  if (normalizedRole === 'admin') {
    return {
      role: 'admin',
      isCustom: false,
      allowedPages: ALL_ROUTES.map((r) => r.path),
      crud: DEFAULT_ROLE_CONFIGS.admin.crud,
    };
  }

  // If no override or override is disabled, return role baseline
  if (!override || !override.enabled) {
    return {
      role: normalizedRole,
      isCustom: false,
      allowedPages: [...baseConfig.allowedPages],
      crud: JSON.parse(JSON.stringify(baseConfig.crud)),
    };
  }

  // Calculate Allowed Pages: (Base + Granted) - Revoked
  const pageSet = new Set<string>(baseConfig.allowedPages);
  (override.grantedPages || []).forEach((p) => pageSet.add(p));
  (override.revokedPages || []).forEach((p) => pageSet.delete(p));

  // Calculate CRUD Matrix
  const effectiveCrud: Record<SystemResource, ResourceCrudPermission> = JSON.parse(
    JSON.stringify(baseConfig.crud)
  );

  ALL_RESOURCES.forEach((res) => {
    ALL_ACTIONS.forEach((action) => {
      // Check granted override
      if (override.grantedCrud?.[res]?.[action] === true) {
        effectiveCrud[res][action] = true;
      }
      // Check revoked override (takes precedence over grant)
      if (override.revokedCrud?.[res]?.[action] === true) {
        effectiveCrud[res][action] = false;
      }
    });
  });

  return {
    role: normalizedRole,
    isCustom: true,
    allowedPages: Array.from(pageSet),
    crud: effectiveCrud,
  };
}

let sharedRedisClient: any = null;

function getSharedRedis() {
  if (sharedRedisClient) return sharedRedisClient;
  try {
    const Redis = require('ioredis');
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    sharedRedisClient = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      enableOfflineQueue: false,
    });
    sharedRedisClient.on('error', () => {});
    return sharedRedisClient;
  } catch {
    return null;
  }
}

async function resolvePermissionsFromRedis(userId: string, role: string): Promise<EffectivePermissions | null> {
  const client = getSharedRedis();
  if (!client) return null;
  try {
    const [rawRole, rawUser] = await Promise.all([
      client.get(`rbac:role:${role}`),
      client.get(`rbac:user:${userId}`),
    ]);
    const roleConfig = rawRole ? JSON.parse(rawRole) : null;
    const userOverride = rawUser ? JSON.parse(rawUser) : null;
    return resolveEffectivePermissions(role, roleConfig, userOverride);
  } catch {
    return null;
  }
}

/**
 * Express middleware to enforce dynamic permissions
 */
export function requireDynamicPermission(
  resource: SystemResource,
  action: CrudAction,
  options?: { getEffectivePerms?: (req: AuthRequest) => Promise<EffectivePermissions | null> }
) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = (req.user?.role || '').toLowerCase();
    if (role === 'admin') {
      return next();
    }

    let perms: EffectivePermissions | null = (req.user as any)?.effectivePermissions || null;

    if (!perms && options?.getEffectivePerms) {
      try {
        perms = await options.getEffectivePerms(req);
      } catch (err: any) {
        console.warn('[PermissionMiddleware] Failed to resolve effective perms from options:', err.message);
      }
    }

    if (!perms) {
      const userId = req.user?.id || req.user?.userId;
      if (userId) {
        try {
          perms = await resolvePermissionsFromRedis(userId, role);
        } catch (err: any) {
          console.warn('[PermissionMiddleware] Failed to resolve from Redis:', err.message);
        }
      }
    }

    if (!perms) {
      perms = resolveEffectivePermissions(role);
    }

    const hasAccess = perms?.crud?.[resource]?.[action];
    if (!hasAccess) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Bạn không có quyền ${action} trên tài nguyên ${resource}`,
        required: `${resource}:${action}`,
      });
      return;
    }

    next();
  };
}

