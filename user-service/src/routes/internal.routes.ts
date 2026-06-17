import { Router } from 'express';
import { config } from '../config';
import { patronService, userRepo } from '../services';

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
  studentCode: user.studentCode,
  cardNumber: user.cardNumber,
  currentStatus: user.currentStatus,
  lastEntryAt: user.lastEntryAt,
  lastEntryCamera: user.lastEntryCamera,
  membershipExpiry: user.membershipExpiry,
});

router.get('/users', async (_req, res) => {
  const [users] = await userRepo.findAll();
  res.json(users.map(toPublic));
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

router.get('/patrons/lookup', async (req, res) => {
  try {
    const studentCode = typeof req.query.student_code === 'string' ? req.query.student_code : undefined;
    const cardNumber = typeof req.query.card_number === 'string' ? req.query.card_number : undefined;
    res.json(await patronService.lookup(studentCode, cardNumber));
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to lookup patron' });
  }
});

router.get('/patrons/search', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const skip = typeof req.query.skip === 'string' ? parseInt(req.query.skip, 10) || 0 : 0;
    const limit = typeof req.query.limit === 'string' ? Math.min(parseInt(req.query.limit, 10) || 20, 100) : 20;
    res.json(await patronService.search(q, status, skip, limit));
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to search patrons' });
  }
});

router.get('/patrons/:id', async (req, res) => {
  try {
    res.json(await patronService.getById(req.params.id));
  } catch (error: any) {
    res.status(error.statusCode || 404).json({ error: error.message || 'Patron not found' });
  }
});

router.post('/patrons', async (req, res) => {
  try {
    res.status(201).json(await patronService.create({
      fullName: req.body.fullName ?? req.body.full_name,
      studentCode: req.body.studentCode ?? req.body.student_code,
      className: req.body.className ?? req.body.class_name,
      membershipExpiry: req.body.membershipExpiry ?? req.body.membership_expiry,
      issueDate: req.body.issueDate ?? req.body.issue_date,
      email: req.body.email,
      phone: req.body.phone,
    }));
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Failed to create patron' });
  }
});

router.put('/patrons/:id', async (req, res) => {
  try {
    res.json(await patronService.update(req.params.id, {
      fullName: req.body.fullName ?? req.body.full_name,
      className: req.body.className ?? req.body.class_name,
      identityNumber: req.body.identityNumber ?? req.body.identity_number,
      email: req.body.email,
      phone: req.body.phone,
      membershipExpiry: req.body.membershipExpiry ?? req.body.membership_expiry,
      status: req.body.status,
    }));
  } catch (error: any) {
    res.status(error.statusCode || 404).json({ error: error.message || 'Failed to update patron' });
  }
});

router.delete('/patrons/:id', async (req, res) => {
  try {
    res.json(await patronService.deletePatron(req.params.id));
  } catch (error: any) {
    res.status(error.statusCode || 404).json({ error: error.message || 'Failed to delete patron' });
  }
});

export default router;
