import { Router, Request, Response } from 'express';
import { scheduleService } from '../services/ScheduleService';
import { config } from '../config';

const router = Router();

function internalAuth(req: Request, res: Response, next: any) {
  const apiKey = req.headers['x-internal-api-key'];
  if (!apiKey || apiKey !== config.internalApiKey) {
    res.status(403).json({ error: 'Invalid or missing internal API key' });
    return;
  }
  next();
}

router.get('/today', internalAuth, async (_req: Request, res: Response) => {
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

export default router;
