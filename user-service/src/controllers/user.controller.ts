import { Request, Response } from 'express';
import { userService, RegisterSchema, LoginSchema } from '../services/user.service';

export class UserController {
  async register(req: Request, res: Response) {
    try {
      const data = RegisterSchema.parse(req.body);
      const result = await userService.register(data);
      res.status(201).json(result);
    } catch (error: any) {
      const message = error.message || 'Registration failed';
      res.status(400).json({ error: message });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const data = LoginSchema.parse(req.body);
      const result = await userService.login(data);
      res.json(result);
    } catch (error: any) {
      const message = error.message || 'Login failed';
      res.status(401).json({ error: message });
    }
  }

  async getMe(req: Request, res: Response) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }

      const token = authHeader.split(' ')[1];
      const payload = userService.verifyToken(token);
      const user = await userService.getUserById(payload.userId);
      res.json(user);
    } catch (error: any) {
      res.status(401).json({ error: 'Invalid token' });
    }
  }

  async getAll(req: Request, res: Response) {
    try {
      const users = await userService.getAllUsers();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }
      const result = await userService.deleteUser(id);
      res.json(result);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }
}

export const userController = new UserController();