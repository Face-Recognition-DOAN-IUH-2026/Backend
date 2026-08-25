import { Router, Response } from 'express';
import type { AuthRequest } from '../../../shared/auth/types';
import { sessionStore } from '../sessions';
import { processCompanionMessage } from '../agent/agent';

const router = Router();

router.post('/stream', async (req: AuthRequest, res: Response) => {
  try {
    const { message, audioBase64, sessionId } = req.body as {
      message?: string;
      audioBase64?: string;
      sessionId?: string;
    };

    if ((!message || typeof message !== 'string') && !audioBase64) {
      res.status(400).json({ error: 'message or audioBase64 is required' });
      return;
    }

    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Block image paste same as chat routes
    if (message) {
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
      const trimmed = message.trim().toLowerCase();
      if (trimmed === 'clipboard' || trimmed === 'paste' || trimmed === 'dan') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        const payload = JSON.stringify({
          type: 'text',
          data: { content: 'Xin loi, toi khong the truy cap clipboard cua ban. Ban vui long nhap noi dung truc tiep bang van ban.' },
        });
        res.write(`data: ${payload}\n\n`);
        const done = JSON.stringify({ type: 'companion_done', data: { sessionId: sessionId || '' } });
        res.write(`data: ${done}\n\n`);
        res.end();
        return;
      }
    }

    const effectivePatronId = user.userId;
    const role = user.role || 'patron';
    let session = sessionId ? sessionStore.getOwned(sessionId, effectivePatronId) : undefined;
    if (!session) {
      session = sessionStore.create(effectivePatronId);
    }

    if (message) {
      sessionStore.addMessage(session.id, {
        role: 'user',
        content: message,
        timestamp: Date.now(),
      });
    }

    const sessionHistory = session.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Disable nginx buffering if present
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let finalText = '';
    for await (const chunk of processCompanionMessage({
      message: message || undefined,
      audioBase64: audioBase64 || undefined,
      sessionId: session.id,
      role,
      patronId: effectivePatronId,
      sessionHistory,
    })) {
      if (chunk.type === 'text' && chunk.data?.content) {
        finalText += chunk.data.content;
      }
      // Persist final assistant message on companion_done
      if (chunk.type === 'companion_done') {
        if (finalText) {
          sessionStore.addMessage(session.id, {
            role: 'assistant',
            content: finalText,
            timestamp: Date.now(),
          });
        }
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      // flush if available
      (res as any).flush?.();
    }

    res.end();
  } catch (error) {
    console.error('Companion stream error:', error);
    if (!res.headersSent) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Companion stream failed', message: msg });
    } else {
      try {
        const errChunk = JSON.stringify({ type: 'error', data: { message: 'Companion stream failed' } });
        res.write(`data: ${errChunk}\n\n`);
        res.end();
      } catch {
        res.end();
      }
    }
  }
});

export default router;
