import { Router, Request, Response } from 'express';
import { sessionStore } from '../sessions';
import { tools } from '../tools/tools';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { sessionId, action } = req.body as {
      sessionId: string;
      action: 'approve' | 'reject';
    };

    if (!sessionId || !action) {
      res.status(400).json({ error: 'sessionId and action are required' });
      return;
    }

    if (!['approve', 'reject'].includes(action)) {
      res.status(400).json({ error: 'action must be "approve" or "reject"' });
      return;
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found or confirmation expired' });
      return;
    }

    if (!session.pendingConfirmation) {
      res.status(400).json({ error: 'No pending confirmation for this session' });
      return;
    }

    const pendingAction = session.pendingConfirmation;

    if (action === 'reject') {
      sessionStore.setConfirmation(sessionId, undefined);
      res.json({
        success: true,
        message: 'Hành động đã bị từ chối.',
      });
      return;
    }

    try {
      const tool = tools.find(t => t.name === pendingAction.toolName);

      if (tool) {
        const argValues = Object.values(pendingAction.toolArgs || {});
        const fn = tool.func as (...args: any[]) => any;
        const result = await fn(...argValues);
        sessionStore.setConfirmation(sessionId, undefined);

        res.json({
          success: true,
          message: 'Hành động đã được thực hiện thành công.',
          result,
        });
      } else {
        res.status(400).json({
          success: false,
          error: `Tool "${pendingAction.toolName}" not found`,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Execution failed',
      });
    }
  } catch (error) {
    console.error('Confirm error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;