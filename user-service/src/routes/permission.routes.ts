import { Router, Response } from 'express';
import { createAuth } from '../../../shared/auth';
import { requireRole } from '../../../shared/auth';
import { config } from '../config';
import { permissionService } from '../services/PermissionService';
import {
  ALL_RESOURCES,
  ALL_ACTIONS,
  ALL_ROUTES,
  resolveEffectivePermissions,
} from '../../../shared/auth/permissions';
import { AuthRequest } from '../../../shared/auth/types';

const auth = createAuth({
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
});

const router = Router();

/**
 * GET /permissions/me
 * Returns the effective permissions for the currently authenticated user
 */
router.get('/me', auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const role = req.user?.role || 'patron';

    if (!userId) {
      // Return default permissions for unauthenticated or anonymous
      const effective = resolveEffectivePermissions(role);
      return res.json({ success: true, data: effective });
    }

    const effective = await permissionService.getEffectivePermissions(userId, role);
    return res.json({ success: true, data: effective });
  } catch (err: any) {
    console.error('[PermissionRoutes] Error resolving /permissions/me:', err);
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
});

/**
 * GET /permissions/matrix
 * Returns all role configs and metadata (Admin only)
 */
router.get('/matrix', auth, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    const roles = await permissionService.getAllRoleConfigs();
    return res.json({
      success: true,
      data: {
        roles,
        metadata: {
          routes: ALL_ROUTES,
          resources: ALL_RESOURCES,
          actions: ALL_ACTIONS,
        },
      },
    });
  } catch (err: any) {
    console.error('[PermissionRoutes] Error getting matrix:', err);
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
});

/**
 * GET /permissions/roles/:role
 * Returns configuration for a specific role (Admin only)
 */
router.get('/roles/:role', auth, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.params;
    const config = await permissionService.getRoleConfig(role);
    return res.json({ success: true, data: config });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
});

/**
 * PUT /permissions/roles/:role
 * Updates configuration for a role (Admin only)
 */
router.put('/roles/:role', auth, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.params;
    const updated = await permissionService.updateRoleConfig(role, req.body);
    return res.json({ success: true, data: updated, message: `Cập nhật quyền vai trò ${role} thành công` });
  } catch (err: any) {
    console.error(`[PermissionRoutes] Error updating role ${req.params.role}:`, err);
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
});

/**
 * GET /permissions/users/:userId
 * Returns custom overrides for a user (Admin only)
 */
router.get('/users/:userId', auth, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const override = await permissionService.getUserOverride(userId);
    return res.json({ success: true, data: override || { enabled: false } });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
});

/**
 * PUT /permissions/users/:userId
 * Updates custom overrides for a specific user (Admin only)
 */
router.put('/users/:userId', auth, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const updated = await permissionService.updateUserOverride(userId, req.body);
    return res.json({
      success: true,
      data: updated,
      message: `Cập nhật phân quyền riêng cho người dùng thành công`,
    });
  } catch (err: any) {
    console.error(`[PermissionRoutes] Error updating user override for ${req.params.userId}:`, err);
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
});

export default router;
