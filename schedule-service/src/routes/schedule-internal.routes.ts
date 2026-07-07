import { Router, Request, Response } from 'express';
import { scheduleService } from '../services/ScheduleService';
import { config } from '../config';
import { createInternalAuth } from '../../../shared/auth';

const internalAuth = createInternalAuth({
  serviceName: 'schedule-service',
  jwtSecret: config.serviceJwtSecret,
});

const router = Router();
router.use(internalAuth);

router.get('/today', async (req: Request, res: Response) => {
  try {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const assignments = await scheduleService.listAssignments({
      from: dateStr,
      to: dateStr,
    });

    res.json(assignments);
  } catch (error) {
    console.error('Error fetching today schedule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/upcoming', internalAuth, async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      res.status(400).json({ error: 'Missing from or to query parameter (YYYY-MM-DD)' });
      return;
    }

    const assignments = await scheduleService.listAssignments({
      from: from as string,
      to: to as string,
    });

    res.json(assignments);
  } catch (error) {
    console.error('Error fetching upcoming schedule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/auto-checkout', internalAuth, async (req: Request, res: Response) => {
  try {
    const result = await scheduleService.autoCheckoutStaleAssignments();
    res.json(result);
  } catch (error) {
    console.error('Error auto-checking out stale assignments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
