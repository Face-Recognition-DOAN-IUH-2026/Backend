import { Router } from 'express';
import { createAuth, requireRole } from '../../../shared/auth';
import type { AuthRequest } from '../../../shared/auth/types';
import { config } from '../config';
import { AppDataSource } from '../data-source';
import { AutomationTask } from '../entities/AutomationTask';
import { AutomationRun } from '../entities/AutomationRun';
import { cronScheduler } from '../scheduler/CronScheduler';
import { eventBus } from '../events/EventBus';

const auth = createAuth({
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
});

const taskRepo = () => AppDataSource.getRepository(AutomationTask);
const runRepo = () => AppDataSource.getRepository(AutomationRun);

const router = Router();
router.use(auth);

/**
 * @swagger
 * /automation/tasks:
 *   get:
 *     summary: Get all automation tasks
 *     tags: [Automation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/tasks', async (req: AuthRequest, res, next) => {
  try {
    const tasks = await taskRepo().find({ order: { createdAt: 'DESC' } });
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /automation/tasks/{id}:
 *   get:
 *     summary: Get a specific automation task by ID
 *     tags: [Automation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *       404:
 *         description: Task not found
 */
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

/**
 * @swagger
 * /automation/tasks/{id}/toggle:
 *   put:
 *     summary: Toggle active status of an automation task
 *     tags: [Automation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *       404:
 *         description: Task not found
 */
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

/**
 * @swagger
 * /automation/tasks/{id}/run:
 *   post:
 *     summary: Manually trigger an automation task
 *     tags: [Automation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Task triggered successfully
 *       404:
 *         description: Task not found
 */
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

/**
 * @swagger
 * /automation/runs:
 *   get:
 *     summary: Get automation runs with optional filtering
 *     tags: [Automation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: taskId
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter runs by task ID
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of runs to return
 *     responses:
 *       200:
 *         description: Success
 */
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

/**
 * @swagger
 * /automation/runs/{id}:
 *   get:
 *     summary: Get a specific automation run by ID
 *     tags: [Automation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *       404:
 *         description: Run not found
 */
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

/**
 * @swagger
 * /automation/events:
 *   post:
 *     summary: Publish an event to the event bus
 *     tags: [Automation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - payload
 *             properties:
 *               type:
 *                 type: string
 *               payload:
 *                 type: object
 *     responses:
 *       200:
 *         description: Event published successfully
 *       400:
 *         description: type and payload are required
 */
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
