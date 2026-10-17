import { Router, Response } from 'express';
import type { AuthRequest } from '../../../shared/auth/types';
import { sessionStore } from '../sessions';

const router = Router();

router.get('/sessions/:sessionId', (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'User not authenticated' });
    return;
  }
  const session = sessionStore.getOwned(req.params.sessionId, user.userId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({
    sessionId: session.id,
    patronId: session.patronId,
    messages: session.messages,
    pendingConfirmation: session.pendingConfirmation,
  });
});

export default router;
