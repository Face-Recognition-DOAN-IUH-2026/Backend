import { Response } from 'express';
import { AuthRequest } from '../middlewares';
import { userService } from '../services';

export class UserController {
  async getAll(_req: AuthRequest, res: Response) {
    try {
      const users = await userService.getAllUsers();
      res.json(users);
    } catch (error: any) {
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
      res.status(404).json({ error: error.message });
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
      res.status(error.statusCode || 404).json({ error: error.message });
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
      res.status(error.statusCode || 404).json({ error: error.message });
    }
  }
}

export const userController = new UserController();
