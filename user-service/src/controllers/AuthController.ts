import { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services';
import { setAuthCookie, clearAuthCookie } from '../../../shared/auth';

const registerSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  full_name: z.string().optional(),
  role: z.enum(['user', 'admin', 'staff', 'patron']).optional(),
  student_code: z.string().optional(),
  skip_verification: z.boolean().optional(),
});

const loginSchema = z
  .object({
    email: z.string().trim().email('Invalid email format').optional(),
    student_code: z.string().optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((d) => Boolean(d.email || d.student_code), {
    message: 'Email or student_code is required',
  });

const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email format'),
});

const resetPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email format'),
  code: z.union([z.string().min(1), z.number()]),
  new_password: z.string().min(6, 'Password must be at least 6 characters'),
});

function validationError(res: Response, issues: z.ZodIssue[]) {
  res.status(400).json({ error: 'Validation Error', detail: issues });
}

export class AuthController {
  async register(req: Request, res: Response) {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(res, parsed.error.issues);
      return;
    }
    try {
      const { email, password, full_name, role, student_code, skip_verification } = parsed.data;
      const result = await authService.register(
        {
          email,
          password,
          fullName: full_name,
          role: role || 'user',
          studentCode: student_code,
          skipVerification: skip_verification,
        },
        (req as any).user?.role,
      );
      if (result.access_token) setAuthCookie(res, result.access_token, result.refresh_token);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message || 'Registration failed' });
    }
  }

  async login(req: Request, res: Response) {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(res, parsed.error.issues);
      return;
    }
    try {
      const { email, student_code, password } = parsed.data;
      const result = await authService.login({
        email,
        studentCode: student_code,
        password,
      });
      if (result.access_token) setAuthCookie(res, result.access_token, result.refresh_token);
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
      const refresh_token = req.body?.refresh_token || req.body?.refreshToken || req.cookies?.refresh_token;
      if (!refresh_token) {
        res.status(400).json({ error: 'refresh_token required' });
        return;
      }
      const result = await authService.refreshToken(refresh_token);
      if (result.access_token) setAuthCookie(res, result.access_token, result.refresh_token);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message || 'Invalid refresh token' });
    }
  }

  async logout(_req: Request, res: Response) {
    clearAuthCookie(res);
    res.json({ message: 'Logged out' });
  }

  async forgotPassword(req: Request, res: Response) {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(res, parsed.error.issues);
      return;
    }
    try {
      await authService.forgotPassword(parsed.data.email);
      res.json({ message: 'Da gui ma reset qua email' });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async verifyResetCode(req: Request, res: Response) {
    try {
      const { email, code } = req.body;
      if (!email || !code) {
        res.status(400).json({ error: 'Email va ma reset la bat buoc' });
        return;
      }
      const isValid = await authService.verifyResetCode(email, code);
      if (!isValid) {
        res.status(400).json({ error: 'Mã khôi phục không hợp lệ hoặc đã hết hạn' });
        return;
      }
      res.json({ valid: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async resetPassword(req: Request, res: Response) {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(res, parsed.error.issues);
      return;
    }
    try {
      const { email, code, new_password } = parsed.data;
      await authService.resetPassword(email, code as string, new_password);
      res.json({ message: 'Đặt lại mật khẩu thành công' });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async verifyEmail(req: Request, res: Response) {
    try {
      const { email, code } = req.body;
      if (!email || !code) {
        res.status(400).json({ error: 'Email va ma xac thuc la bat buoc' });
        return;
      }
      await authService.verifyEmail(email, code);
      res.json({ message: 'Xác thực email thành công' });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async resendVerification(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ error: 'Email la bat buoc' });
        return;
      }
      await authService.resendVerificationEmail(email);
      res.json({ message: 'Da gui ma xac thuc moi' });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async requestEmailCorrection(req: Request, res: Response) {
    try {
      const { current_email, new_email } = req.body;
      if (!current_email || !new_email) {
        res.status(400).json({ error: 'current_email va new_email la bat buoc' });
        return;
      }
      await authService.requestEmailCorrection(current_email, new_email);
      res.json({ message: 'Da gui ma OTP den email moi' });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async verifyEmailCorrection(req: Request, res: Response) {
    try {
      const { current_email, new_email, code } = req.body;
      if (!current_email || !new_email || !code) {
        res.status(400).json({ error: 'current_email, new_email, va code la bat buoc' });
        return;
      }
      await authService.verifyEmailAndCorrect(current_email, new_email, code);
      res.json({ message: 'Đổi email và xác thực thành công' });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }
}

export const authController = new AuthController();
