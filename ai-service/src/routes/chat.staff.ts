import { Router, Response } from 'express';
import type { AuthRequest } from '../../../shared/auth/types';
import { sessionStore } from '../sessions';
import { processMessage } from '../agent/agent';
import { staffToolDefs } from '../tools/registry';

const router = Router();

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { message, sessionId, patronId } = req.body as {
      message: string;
      sessionId?: string;
      patronId?: string;
    };

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required and must be a string' });
      return;
    }

    const hasImageContent =
      message.includes('data:image/') ||
      /\bdata:image\/[^;]+;base64,/i.test(message) ||
      /\bimage\/[^;\s]*/i.test(message);

    if (hasImageContent) {
      res.status(400).json({
        error: 'Image input not supported',
        message: 'Xin loi, tinh nang nay chi ho tro tin nhan van ban.',
      });
      return;
    }

    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const trimmedMessage = message.trim().toLowerCase();
    if (trimmedMessage === 'clipboard' || trimmedMessage === 'paste' || trimmedMessage === 'dan') {
      res.json({
        response: 'Xin loi, toi khong the truy cap clipboard cua ban. Ban vui long nhap noi dung truc tiep bang van ban.',
        requiresConfirmation: false,
        sessionId: undefined,
        userRole: user.role,
      });
      return;
    }

    const effectivePatronId = user.userId;
    let session = sessionId ? sessionStore.getOwned(sessionId, effectivePatronId) : undefined;
    if (!session) {
      session = sessionStore.create(effectivePatronId);
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
      user.role,
      sessionHistory,
      userContext,
      staffToolDefs,
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
    console.error('Staff chat error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit');
    const isBothFailed = errorMessage.includes('Both LLM providers failed');

    const userMessage = isRateLimit
      ? 'He thong dang ban, vui long thu lai sau vai giay.'
      : isBothFailed
        ? 'Dich vu AI tam thoi khong kha dung, vui long thu lai sau.'
        : 'Da xay ra loi, vui long thu lai.';

    res.status(isRateLimit ? 429 : isBothFailed ? 503 : 500).json({
      error: isRateLimit ? 'Rate limit exceeded' : isBothFailed ? 'Service unavailable' : 'Internal server error',
      message: userMessage,
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    });
  }
});

router.get('/sessions/:sessionId', (req: AuthRequest, res: Response) => {
  const { sessionId } = req.params;
  const user = req.user;

  if (!user) {
    res.status(401).json({ error: 'User not authenticated' });
    return;
  }

  const session = sessionStore.getOwned(sessionId, user.userId);
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
