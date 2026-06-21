import { Router } from 'express';
import { auth, requireRole, AuthRequest } from '../middlewares/auth';
import { AppDataSource } from '../data-source';
import { AutomationTask } from '../entities/AutomationTask';
import { AutomationRun } from '../entities/AutomationRun';
import { cronScheduler } from '../scheduler/CronScheduler';
import { eventBus } from '../events/EventBus';

const taskRepo = () => AppDataSource.getRepository(AutomationTask);
const runRepo = () => AppDataSource.getRepository(AutomationRun);

const router = Router();
router.use(auth);

router.get('/tasks', async (req: AuthRequest, res, next) => {
  try {
    const tasks = await taskRepo().find({ order: { createdAt: 'DESC' } });
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

router.get('/tasks/:id', async (req: AuthRequest, res, next) => {
  try {
    const task = await taskRepo().findOne({ where: { id: req.params.id } });
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
});

router.put('/tasks/:id/toggle', async (req: AuthRequest, res, next) => {
  try {
    const task = await taskRepo().findOne({ where: { id: req.params.id } });
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    task.isActive = !task.isActive;
    await taskRepo().save(task);
    res.json(task);
  } catch (error) {
    next(error);
  }
});

router.post('/tasks/:id/run', async (req: AuthRequest, res, next) => {
  try {
    const task = await taskRepo().findOne({ where: { id: req.params.id } });
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    // Execute task manually in background
    cronScheduler.executeTask(task, 'manual').catch(console.error);
    res.json({ message: `Task ${task.name} triggered manually` });
  } catch (error) {
    next(error);
  }
});

router.get('/runs', async (req: AuthRequest, res, next) => {
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

router.get('/runs/:id', async (req: AuthRequest, res, next) => {
  try {
    const run = await runRepo().findOne({ where: { id: req.params.id } });
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  } catch (error) {
    next(error);
  }
});

router.post('/events', async (req: AuthRequest, res, next) => {
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
