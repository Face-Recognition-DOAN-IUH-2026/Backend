import { Request, Response } from 'express';
import type { AuthRequest } from '../../../shared/auth/types';
import { userService } from '../services';

const AVATAR_MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export class UserController {
  async getAll(req: AuthRequest, res: Response) {
    try {
      const skip = parseInt(typeof req.query.skip === 'string' ? req.query.skip : '0', 10) || 0;
      const limit = parseInt(typeof req.query.limit === 'string' ? req.query.limit : '200', 10) || 200;
      const result = await userService.getAllUsers(skip, limit);
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
        res.status(400).json({ error: 'Vui lòng nhập mật khẩu cũ và mới' });
        return;
      }
      if (new_password.length < 6) {
        res.status(400).json({ error: 'Mật khẩu mới phải ít nhất 6 ký tự' });
        return;
      }
      await userService.changePassword(req.user.userId, old_password, new_password);
      res.json({ message: 'Đổi mật khẩu thành công' });
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
      res.json({ message: 'Đổi email thành công' });
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

  async adminUpdateUser(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }
      const result = await userService.adminUpdateUser(id, {
        fullName: req.body.full_name,
        phone: req.body.phone,
        studentCode: req.body.student_code,
        className: req.body.class_name,
        identityNumber: req.body.identity_number,
        course: req.body.course,
        permanentAddress: req.body.permanent_address,
        cardNumber: req.body.card_number,
        issueDate: req.body.issue_date,
        membershipExpiry: req.body.membership_expiry,
        role: req.body.role,
        status: req.body.status,
        suspendedReason: req.body.suspended_reason,
        avatarUrl: req.body.avatar_url,
      });
      res.json(result);
    } catch (error: any) {
      console.error('AdminUpdateUser Error:', error);
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
        res.status(400).json({ error: 'Kich thuoc anh toi da 5MB' });
        return;
      }

      const avatarUrl = await userService.updateAvatar(req.user.userId, file.buffer, file.mimetype);
      res.json({ avatarUrl, avatar_url: avatarUrl });
    } catch (error: any) {
      console.error('Upload Avatar Error:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Tải lên ảnh đại diện thất bại' });
    }
  }

  async deleteAvatar(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      await userService.deleteAvatar(req.user.userId);
      res.json({ message: 'Xóa ảnh đại diện thành công' });
    } catch (error: any) {
      console.error('Delete Avatar Error:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Xóa ảnh đại diện thất bại' });
    }
  }
}

export const userController = new UserController();
