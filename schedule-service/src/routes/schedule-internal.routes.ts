import { Router, Request, Response } from 'express';
import { scheduleService } from '../services/ScheduleService';
import { config } from '../config';

const router = Router();

function logInternalAccess(serviceName: string, endpoint: string, key: string, success: boolean) {
  const fingerprint = key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : 'none';
  const timestamp = new Date().toISOString();
  const status = success ? 'SUCCESS' : 'FAILED';
  console.log(`[InternalAudit] ${timestamp} ${serviceName} ${endpoint} key=${fingerprint} status=${status}`);
}

function internalAuth(req: Request, res: Response, next: any) {
  const apiKey = req.headers['x-internal-api-key'] as string;
  if (!apiKey || apiKey !== config.internalApiKey) {
    logInternalAccess('schedule-service', req.path, apiKey || '', false);
    res.status(403).json({ error: 'Invalid or missing internal API key' });
    return;
  }
  logInternalAccess('schedule-service', req.path, apiKey, true);
  next();
}

router.get('/today', internalAuth, async (req: Request, res: Response) => {
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

export default router;
