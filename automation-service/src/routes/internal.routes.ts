import { Router } from 'express';
import { createInternalAuth } from '../../../shared';
import { config } from '../config';
import { AppDataSource } from '../data-source';
import { AutomationTask } from '../entities/AutomationTask';
import { AutomationRun } from '../entities/AutomationRun';
import { eventBus } from '../events/EventBus';

const internalAuth = createInternalAuth({
  serviceName: 'automation-service',
  jwtSecret: config.serviceJwtSecret,
});

const taskRepo = () => AppDataSource.getRepository(AutomationTask);
const runRepo = () => AppDataSource.getRepository(AutomationRun);

const router = Router();
router.use(internalAuth);

router.get('/tasks', async (req, res, next) => {
  try {
    const tasks = await taskRepo().find({ order: { createdAt: 'DESC' } });
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

router.get('/runs', async (req, res, next) => {
  try {
    const taskId = req.query.taskId as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const where: any = taskId ? { taskId } : {};
    const runs = await runRepo().find({ where, order: { startedAt: 'DESC' }, take: limit });
    res.json(runs);
  } catch (error) {
    next(error);
  }
});

router.post('/events', async (req, res, next) => {
  try {
    const { type, payload } = req.body;
    if (!type || !payload) {
      res.status(400).json({ error: 'type and payload are required' });
      return;
    }
    await eventBus.publish({ type, payload, timestamp: new Date().toISOString() });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
