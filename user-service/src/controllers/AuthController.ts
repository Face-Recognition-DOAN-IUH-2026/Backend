import { Request, Response } from 'express';
import { authService } from '../services';

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { email, password, full_name, role, student_code } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
      }
      const result = await authService.register({
        email,
        password,
        fullName: full_name,
        role: role || 'user',
        studentCode: student_code,
      });
      res.status(201).json(result);
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message || 'Registration failed' });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const { email, student_code, password } = req.body;
      if (!password || (!email && !student_code)) {
        res.status(400).json({ error: 'Email/student_code and password are required' });
        return;
      }
      const result = await authService.login({
        email,
        studentCode: student_code,
        password,
      });
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || 401).json({ error: error.message || 'Login failed' });
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
      const payload = authService.verifyToken(token, 'access');
      const user = await authService.getUserById(payload.userId);
      res.json(user);
    } catch (error: any) {
      res.status(401).json({ error: 'Invalid token' });
    }
  }

  async refresh(req: Request, res: Response) {
    try {
      const { refresh_token } = req.body;
      if (!refresh_token) {
        res.status(400).json({ error: 'refresh_token required' });
        return;
      }
      const result = await authService.refreshToken(refresh_token);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  }

}

export const authController = new AuthController();
