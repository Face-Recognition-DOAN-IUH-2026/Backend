import { Router } from 'express';
import { config } from '../config';
import { patronService, userService, userRepo } from '../services';

const router = Router();

router.use((req, _res, next) => {
  const key = req.headers['x-internal-api-key'];
  if (!key || key !== config.internalApiKey) {
    _res.status(403).json({ error: 'Invalid internal API key' });
    return;
  }
  next();
});

router.get('/users', async (req, res) => {
  const role = typeof req.query.role === 'string' ? req.query.role : undefined;
  if (role) {
    const all = await userRepo.findAll(0, 1000);
    const filtered = all[0].filter((u: any) => u.role === role);
    res.json(filtered.map((u: any) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      status: u.status,
      studentCode: u.studentCode,
      cardNumber: u.cardNumber,
      avatarUrl: u.avatarUrl,
      currentStatus: u.currentStatus,
      lastEntryAt: u.lastEntryAt,
      lastEntryCamera: u.lastEntryCamera,
      membershipExpiry: u.membershipExpiry,
    })));
  } else {
    const [users] = await userRepo.findAll();
    res.json(users.map((u: any) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      status: u.status,
      studentCode: u.studentCode,
      cardNumber: u.cardNumber,
      avatarUrl: u.avatarUrl,
      currentStatus: u.currentStatus,
      lastEntryAt: u.lastEntryAt,
      lastEntryCamera: u.lastEntryCamera,
      membershipExpiry: u.membershipExpiry,
    })));
  }
});

router.get('/users/expiring-membership', async (req, res) => {
  try {
    const days = parseInt(typeof req.query.days === 'string' ? req.query.days : '7', 10) || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + days);

    const [users] = await userRepo.findAll(0, 10000);
    const expiring = users.filter((u: any) => {
      if (u.role !== 'patron' || !u.membershipExpiry) return false;
      const expiry = new Date(u.membershipExpiry);
      return expiry <= cutoffDate && expiry >= new Date();
    });

    res.json(expiring.map((u: any) => ({
      id: u.id,
      fullName: u.fullName,
      membershipExpiry: u.membershipExpiry,
    })));
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to check expiring memberships' });
  }
});

router.get('/users/:id', async (req, res) => {
  const user = await userRepo.findById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    studentCode: user.studentCode,
    cardNumber: user.cardNumber,
    avatarUrl: user.avatarUrl,
    currentStatus: user.currentStatus,
    lastEntryAt: user.lastEntryAt,
    lastEntryCamera: user.lastEntryCamera,
    membershipExpiry: user.membershipExpiry,
  });
});

router.post('/users/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array is required' });
      return;
    }
    const results: Record<string, any> = {};
    for (const id of ids) {
      const user = await userRepo.findById(id);
      if (user) {
        results[id] = {
          id: user.id,
          fullName: user.fullName,
          studentCode: user.studentCode,
          cardNumber: user.cardNumber,
          email: user.email,
          role: user.role,
          status: user.status,
          currentStatus: user.currentStatus,
          membershipExpiry: user.membershipExpiry,
        };
      }
    }
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to batch lookup users' });
  }
});

router.get('/staff', async (req, res) => {
  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map((id: string) => id.trim()).filter(Boolean)
    : undefined;
  const staff = await userRepo.findStaff(ids);
  res.json(staff.map((u: any) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    status: u.status,
    studentCode: u.studentCode,
    cardNumber: u.cardNumber,
    currentStatus: u.currentStatus,
    membershipExpiry: u.membershipExpiry,
  })));
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

router.delete('/users/:id', async (req, res) => {
  try {
    res.json(await userService.deleteUser(req.params.id));
  } catch (error: any) {
    res.status(error.statusCode || 404).json({ error: error.message || 'Failed to delete user' });
  }
});

export default router;