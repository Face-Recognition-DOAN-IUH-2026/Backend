import { Router } from 'express';
import { z } from 'zod';
import { auth, AuthRequest, requireRole } from '../middlewares/auth';
import { WaitlistService } from '../services/WaitlistService';

const router = Router();
router.use(auth);
const waitlistService = new WaitlistService();

function patronIdFrom(user: AuthRequest['user']) {
  if (!user?.id) throw Object.assign(new Error('Invalid or expired token'), { statusCode: 401 });
  return user.id;
}

router.post('/', requireRole(['patron', 'admin', 'staff'], 'Chi doc gia, admin, nhan vien moi vao danh sach cho'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ book_id: z.string().uuid() }).parse(req.body);
    const userId = patronIdFrom(req.user);
    const entry = await waitlistService.joinWaitlist(body.book_id, userId);
    res.status(201).json(entry);
  } catch (error: any) {
    if (error.statusCode === 409) {
      res.status(409).json({ detail: error.message });
      return;
    }
    if (error.statusCode === 404) {
      res.status(404).json({ detail: error.message });
      return;
    }
    next(error);
  }
});

router.delete('/:id', requireRole(['patron', 'admin', 'staff'], 'Chi doc gia, admin, nhan vien moi huy danh sach cho'), async (req: AuthRequest, res, next) => {
  try {
    const userId = patronIdFrom(req.user);
    await waitlistService.cancelWaitlist(req.params.id, userId);
    res.status(204).end();
  } catch (error: any) {
    if (error.statusCode === 403) {
      res.status(403).json({ detail: error.message });
      return;
    }
    if (error.statusCode === 404) {
      res.status(404).json({ detail: error.message });
      return;
    }
    next(error);
  }
});

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const userId = patronIdFrom(req.user);
    const result = await waitlistService.listWaitlist(userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
