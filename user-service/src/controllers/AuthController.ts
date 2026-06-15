import { Request, Response } from 'express';
import { authService } from '../services';

const isProduction = process.env.NODE_ENV === 'production';
const accessCookieMaxAgeMs = 15 * 60 * 1000;
const refreshCookieMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

function setAuthCookies(res: Response, result: { access_token?: string; refresh_token?: string | null }) {
  if (result.access_token) {
    res.cookie('access_token', result.access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: accessCookieMaxAgeMs,
    });
  }

  if (result.refresh_token) {
    res.cookie('refresh_token', result.refresh_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/auth',
      maxAge: refreshCookieMaxAgeMs,
    });
  }
}

function clearAuthCookies(res: Response) {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/auth' });
}

function getCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(';').map((part) => part.trim());
  const match = cookies.find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

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
      setAuthCookies(res, result);
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
      setAuthCookies(res, result);
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
      const refreshToken = refresh_token || getCookie(req, 'refresh_token');
      if (!refreshToken) {
        res.status(400).json({ error: 'refresh_token required' });
        return;
      }
      const result = await authService.refreshToken(refreshToken);
      setAuthCookies(res, result);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  }

  async logout(_req: Request, res: Response) {
    clearAuthCookies(res);
    res.status(204).send();
  }
}

export const authController = new AuthController();
