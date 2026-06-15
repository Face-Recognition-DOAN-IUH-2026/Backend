import { Router } from 'express';
import { config } from '../config';
import { userRepo } from '../services';

const router = Router();

router.use((req, res, next) => {
  const key = req.headers['x-internal-api-key'];
  if (!key || key !== config.internalApiKey) {
    res.status(403).json({ error: 'Invalid internal API key' });
    return;
  }
  next();
});

const toPublic = (user: any) => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  status: user.status,
});

router.get('/users/:id', async (req, res) => {
  const user = await userRepo.findById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(toPublic(user));
});

router.get('/staff', async (req, res) => {
  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map((id) => id.trim()).filter(Boolean)
    : undefined;
  const staff = await userRepo.findStaff(ids);
  res.json(staff.map(toPublic));
});

export default router;
