import { Response } from 'express';
import { AuthRequest } from '../../shared';
import { userService } from '../services';

const AVATAR_MAX_SIZE = 2 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export class UserController {
  async getAll(_req: AuthRequest, res: Response) {
    try {
      const result = await userService.getAllUsers();
      res.json(result);
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }

  async getById(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }
      const user = await userService.getUserById(id);
      res.json(user);
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(404).json({ error: error.message });
    }
  }

  async getMe(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const user = await userService.getUserById(req.user.userId);
      res.json(user);
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(404).json({ error: error.message });
    }
  }

  async updateProfile(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const { full_name, phone, permanent_address } = req.body;
      const result = await userService.updateProfile(req.user.userId, {
        fullName: full_name,
        phone,
        permanentAddress: permanent_address,
      });
      res.json(result);
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async changePassword(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const { old_password, new_password } = req.body;
      if (!old_password || !new_password) {
        res.status(400).json({ error: 'Vui long nhap mat khau cu va moi' });
        return;
      }
      if (new_password.length < 6) {
        res.status(400).json({ error: 'Mat khau moi phai it nhat 6 ki tu' });
        return;
      }
      await userService.changePassword(req.user.userId, old_password, new_password);
      res.json({ message: 'Doi mat khau thanh cong' });
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async requestEmailChangeOtp(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const { new_email } = req.body;
      if (!new_email) {
        res.status(400).json({ error: 'Vui long nhap email moi' });
        return;
      }
      await userService.requestEmailChangeOtp(req.user.userId, new_email);
      res.json({ message: 'Da gui ma OTP den email moi' });
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async verifyAndChangeEmail(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const { new_email, code } = req.body;
      if (!new_email || !code) {
        res.status(400).json({ error: 'Vui long nhap email moi va ma OTP' });
        return;
      }
      await userService.verifyAndChangeEmail(req.user.userId, new_email, code);
      res.json({ message: 'Doi email thanh cong' });
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async delete(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }
      const result = await userService.deleteUser(id);
      res.json(result);
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(error.statusCode || 404).json({ error: error.message });
    }
  }

  async restore(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }
      const user = await userService.restoreUser(id);
      res.json(user);
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async updateAccessStatus(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }

      const { current_status, currentStatus, camera_id, cameraId } = req.body;
      const nextStatus = current_status ?? currentStatus;
      if (!['inside', 'outside'].includes(nextStatus)) {
        res.status(400).json({ error: 'current_status must be inside or outside' });
        return;
      }

      const user = await userService.updateAccessStatus(
        id,
        nextStatus,
        camera_id ?? cameraId ?? null,
      );
      res.json(user);
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(error.statusCode || 404).json({ error: error.message });
    }
  }

  async uploadAvatar(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const file = (req as any).file;
      if (!file) {
        res.status(400).json({ error: 'Vui l� ch?n file ?nh' });
        return;
      }

      if (!ALLOWED_MIME.includes(file.mimetype)) {
        res.status(400).json({ error: 'Chi ch?p nh?n JPG, PNG ho?c WebP' });
        return;
      }

      if (file.size > AVATAR_MAX_SIZE) {
        res.status(400).json({ error: 'Kich thu?c ?nh t?i �a 2MB' });
        return;
      }

      const avatarUrl = await userService.updateAvatar(req.user.userId, file.buffer, file.mimetype);
      res.json({ avatarUrl });
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Upload avatar that bai' });
    }
  }

  async deleteAvatar(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      await userService.deleteAvatar(req.user.userId);
      res.json({ message: 'Xoa avatar thanh cong' });
    } catch (error: any) {
        console.error('Delete User Error:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Xoa avatar that bai' });
    }
  }
}

export const userController = new UserController();
