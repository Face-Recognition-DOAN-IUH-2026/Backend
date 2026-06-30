import { Request, Response } from 'express';
import { authService } from '../services';

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { email, password, full_name, role, student_code, skip_verification } = req.body;
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
        skipVerification: skip_verification,
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

  async forgotPassword(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ error: 'Email la bat buoc' });
        return;
      }
      await authService.forgotPassword(email);
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
        res.status(400).json({ error: 'Ma reset khong hop le hoac da het han' });
        return;
      }
      res.json({ valid: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async resetPassword(req: Request, res: Response) {
    try {
      const { email, code, new_password } = req.body;
      if (!email || !code || !new_password) {
        res.status(400).json({ error: 'Email, ma reset, va mat khau moi la bat buoc' });
        return;
      }
      if (new_password.length < 6) {
        res.status(400).json({ error: 'Mat khau moi phai it nhat 6 ki tu' });
        return;
      }
      await authService.resetPassword(email, code, new_password);
      res.json({ message: 'Dat lai mat khau thanh cong' });
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
      res.json({ message: 'Xac thuc email thanh cong' });
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
      res.json({ message: 'Doi email va xac thuc thanh cong' });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

}

export const authController = new AuthController();
