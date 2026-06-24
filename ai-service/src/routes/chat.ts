import { Router, Request, Response } from 'express';
import { sessionStore } from '../sessions';
import { processMessage } from '../agent/agent';
import { AuthRequest } from '../middlewares/auth';

const router = Router();

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { message, sessionId, patronId: clientPatronId } = req.body as {
      message: string;
      sessionId?: string;
      patronId?: string;
    };

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required and must be a string' });
      return;
    }

    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const isStaff = user.role === 'admin' || user.role === 'staff';

    // Security: patron can only query own data, staff can query any patron
    let effectivePatronId: string;
    if (isStaff) {
      effectivePatronId = clientPatronId || user.userId;
    } else {
      // Patron: ignore client patronId, always use JWT identity
      effectivePatronId = user.userId;
    }

    let session = sessionId ? sessionStore.get(sessionId) : undefined;

    if (!session) {
      session = sessionStore.create(effectivePatronId);
    } else if (effectivePatronId) {
      sessionStore.update(session.id, { patronId: effectivePatronId });
    }

    sessionStore.addMessage(session.id, {
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    const sessionHistory = session.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const userContext = {
      userId: user.userId,
      email: user.email,
      role: user.role,
      fullName: user.fullName || undefined,
    };

    const result = await processMessage(
      message,
      session.id,
      effectivePatronId,
      sessionHistory,
      userContext,
    );

    sessionStore.addMessage(session.id, {
      role: 'assistant',
      content: result.response,
      timestamp: Date.now(),
    });

    if (result.requiresConfirmation && result.pendingTool) {
      sessionStore.setConfirmation(session.id, {
        action: message,
        toolName: result.pendingTool.name,
        toolArgs: result.pendingTool.args,
        description: result.pendingTool.description,
      });
    } else if (session?.pendingConfirmation) {
      sessionStore.setConfirmation(session.id, undefined);
    }

    res.json({
      response: result.response,
      requiresConfirmation: result.requiresConfirmation,
      pendingAction: result.pendingTool ? {
        action: result.pendingTool.name,
        description: result.pendingTool.description,
        params: result.pendingTool.args,
      } : undefined,
      toolResults: result.toolResults,
      sessionId: session.id,
      userRole: user.role,
    });
  } catch (error) {
    console.error('Chat error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit');
    const isBothFailed = errorMessage.includes('Both LLM providers failed');

    const userMessage = isRateLimit
      ? 'Hệ thống đang bận, vui lòng thử lại sau vài giây.'
      : isBothFailed
        ? 'Dịch vụ AI tạm thời không khả dụng, vui lòng thử lại sau.'
        : 'Đã xảy ra lỗi, vui lòng thử lại.';

    res.status(isRateLimit ? 429 : 500).json({
      error: isRateLimit ? 'Rate limit exceeded' : 'Internal server error',
      message: userMessage,
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    });
  }
});

router.get('/sessions/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;

  const session = sessionStore.get(sessionId);
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
