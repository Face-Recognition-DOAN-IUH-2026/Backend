import { Request, Response } from 'express';
import { AuthRequest } from '../../shared';
import { patronService } from '../services';

export class PatronController {
  async register(req: Request, res: Response) {
    try {
      const { student_code, password, full_name, class_name, course, permanent_address, email } = req.body;
      if (!student_code || !password || !full_name) {
        res.status(400).json({ error: 'student_code, password, and full_name are required' });
        return;
      }
      const authService = (await import('../services')).authService;
      const result = await authService.register({
        email: email || `${student_code}@library.local`,
        password,
        fullName: full_name,
        role: 'patron',
        studentCode: student_code,
        className: class_name,
        course,
        permanentAddress: permanent_address,
      });
      res.status(201).json(result);
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message || 'Registration failed' });
    }
  }

  async getMe(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const patron = await patronService.getById(req.user.userId);
      res.json(patron);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const { student_code, password } = req.body;
      if (!student_code || !password) {
        res.status(400).json({ error: 'student_code and password are required' });
        return;
      }
      const authService = (await import('../services')).authService;
      const result = await authService.login({ studentCode: student_code, password });
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || 401).json({ error: error.message || 'Login failed' });
    }
  }

  async search(req: AuthRequest, res: Response) {
    try {
      const q = req.query.q as string | undefined;
      const status = req.query.status as string | undefined;
      const skip = parseInt(req.query.skip as string) || 0;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const result = await patronService.search(q, status, skip, limit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to search patrons' });
    }
  }

  async lookup(req: AuthRequest, res: Response) {
    try {
      const studentCode = req.query.student_code as string | undefined;
      const cardNumber = req.query.card_number as string | undefined;

      const result = await patronService.lookup(studentCode, cardNumber);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to lookup patron' });
    }
  }

  async getById(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid patron ID' });
        return;
      }
      const patron = await patronService.getById(id);
      res.json(patron);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }

  async create(req: AuthRequest, res: Response) {
    try {
      const { full_name, student_code, class_name, course, permanent_address, membership_expiry, issue_date, identity_number, email, phone } = req.body;
      if (!full_name || !student_code || !membership_expiry) {
        res.status(400).json({ error: 'full_name, student_code, and membership_expiry are required' });
        return;
      }
      const patron = await patronService.create({
        fullName: full_name,
        studentCode: student_code,
        className: class_name,
        course,
        permanentAddress: permanent_address,
        membershipExpiry: membership_expiry,
        issueDate: issue_date,
        identityNumber: identity_number,
        email,
        phone,
      });
      res.status(201).json(patron);
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async update(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid patron ID' });
        return;
      }
      const {
        full_name,
        class_name,
        course,
        permanent_address,
        identity_number,
        email,
        phone,
        membership_expiry,
        status,
      } = req.body;
      const patron = await patronService.update(id, {
        fullName: full_name,
        className: class_name,
        course,
        permanentAddress: permanent_address,
        identityNumber: identity_number,
        email,
        phone,
        membershipExpiry: membership_expiry,
        status,
      });
      res.json(patron);
    } catch (error: any) {
      res.status(error.statusCode || 404).json({ error: error.message });
    }
  }

  async delete(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid patron ID' });
        return;
      }
      const result = await patronService.deletePatron(id);
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || 404).json({ error: error.message });
    }
  }

  async getActive(_req: AuthRequest, res: Response) {
    try {
      const patrons = await patronService.getActivePatrons();
      res.json({ items: patrons, total: patrons.length });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch active patrons' });
    }
  }

  async getStats(_req: AuthRequest, res: Response) {
    try {
      const stats = await patronService.getStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  }

  async changePassword(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid patron ID' });
        return;
      }
      const currentUser = req.user;
      if (!currentUser) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const isAdminOrStaff = currentUser.role === 'admin' || currentUser.role === 'staff';
      if (currentUser.userId !== id && !isAdminOrStaff) {
        res.status(403).json({ error: 'You can only change your own password' });
        return;
      }
      const { current_password, new_password } = req.body;
      if (!new_password || new_password.length < 8) {
        res.status(400).json({ error: 'New password must be at least 8 characters' });
        return;
      }
      await patronService.changePassword(
        id,
        current_password ?? null,
        new_password,
      );
      res.json({ success: true, message: 'Password changed successfully' });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async restore(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid patron ID' });
        return;
      }
      const patron = await patronService.restorePatron(id);
      res.json(patron);
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async suspendCard(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid patron ID' });
        return;
      }
      const { reason } = req.body;
      if (!reason) {
        res.status(400).json({ error: 'Suspension reason is required' });
        return;
      }
      const patron = await patronService.suspendCard(id, reason);
      res.json(patron);
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async renewCard(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid patron ID' });
        return;
      }
      const patron = await patronService.renewCard(id);
      res.json(patron);
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  async reportLostCard(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id;
      if (!id || id === 'undefined') {
        res.status(400).json({ error: 'Invalid patron ID' });
        return;
      }
      const patron = await patronService.reportLostCard(id);
      res.json(patron);
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }
}

export const patronController = new PatronController();
