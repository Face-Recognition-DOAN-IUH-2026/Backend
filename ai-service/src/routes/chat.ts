import { Router, Response } from 'express';
import { sessionStore } from '../sessions';
import { processMessage } from '../agent/agent';
import { AuthRequest } from '../middlewares/auth';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: AI Assistant
 *     description: AI chatbot powered by NVIDIA NIM — supports book search, borrow history, overdue queries, schedules, and general library assistance
 */

/**
 * @swagger
 * /ai/chat:
 *   post:
 *     summary: Send a message to the AI assistant
 *     description: |
 *       Send a natural language message to the library AI assistant. The AI can:
 *       - Search for books by title, author, or topic
 *       - Retrieve patron borrow history
 *       - Check overdue books and due dates
 *       - Look up library schedules and opening hours
 *       - Answer general library questions
 *
 *       The response includes the AI's text reply and optional `toolResults` with structured data
 *       (book cards, schedule cards, overdue cards) that the frontend should render as rich UI components.
 *
 *       **Tool Results Types:**
 *       - `book_search` — list of books matching the query
 *       - `book_lookup` — single book detail
 *       - `patron_borrows` — patron borrow history with status
 *       - `overdue_books` — overdue borrow records with fine info
 *       - `library_schedule` — current and upcoming library hours
 *     tags: [AI Assistant]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 description: The user's natural language message
 *                 example: "Tìm sách về lập trình Python"
 *               sessionId:
 *                 type: string
 *                 description: Existing session ID to continue a conversation. Omit to start a new session.
 *                 example: "sess_abc123xyz"
 *               patronId:
 *                 type: string
 *                 description: (Staff only) Override the patron ID to query on behalf of a specific patron
 *                 example: "3f7a8b2c-1234-5678-abcd-ef0123456789"
 *           examples:
 *             searchBooks:
 *               summary: Search for books
 *               value:
 *                 message: "Tìm sách lập trình Python cho người mới"
 *             borrowHistory:
 *               summary: Check borrow history
 *               value:
 *                 message: "Xem lịch sử mượn sách của tôi"
 *                 sessionId: "sess_abc123xyz"
 *             overdueBooks:
 *               summary: Check overdue books
 *               value:
 *                 message: "Tôi có sách nào trễ hạn không?"
 *             schedule:
 *               summary: Check library schedule
 *               value:
 *                 message: "Lịch trực thư viện tuần này như thế nào?"
 *     responses:
 *       200:
 *         description: AI response with optional structured tool results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 response:
 *                   type: string
 *                   description: The AI's text response in Vietnamese
 *                   example: "Tôi tìm thấy 3 cuốn sách về Python. Đây là danh sách:"
 *                 sessionId:
 *                   type: string
 *                   description: Session ID for continuing the conversation
 *                   example: "sess_abc123xyz"
 *                 userRole:
 *                   type: string
 *                   enum: [patron, staff, admin]
 *                   description: Role of the authenticated user
 *                 requiresConfirmation:
 *                   type: boolean
 *                   description: True when the AI needs user confirmation before executing an action
 *                 pendingAction:
 *                   type: object
 *                   nullable: true
 *                   description: Details of the pending action requiring confirmation
 *                   properties:
 *                     action:
 *                       type: string
 *                       example: "extend_borrow"
 *                     description:
 *                       type: string
 *                       example: "Gia hạn sách 'Clean Code' thêm 7 ngày?"
 *                     params:
 *                       type: object
 *                 toolResults:
 *                   type: array
 *                   description: Structured data returned by tool calls — render as rich UI cards
 *                   items:
 *                     type: object
 *                     properties:
 *                       tool:
 *                         type: string
 *                         description: Tool identifier
 *                         enum: [search_books, get_book_details, get_patron_borrows, get_overdue_books, get_library_schedule]
 *                       result:
 *                         type: object
 *                         properties:
 *                           success:
 *                             type: boolean
 *                           data:
 *                             description: Tool-specific structured data (books array, borrow records, schedule slots, etc.)
 *             examples:
 *               bookSearch:
 *                 summary: Book search result
 *                 value:
 *                   response: "Tôi tìm thấy 2 cuốn sách về Python:"
 *                   sessionId: "sess_abc123xyz"
 *                   userRole: "patron"
 *                   requiresConfirmation: false
 *                   toolResults:
 *                     - tool: "search_books"
 *                       result:
 *                         success: true
 *                         data:
 *                           - title: "Python Crash Course"
 *                             author: "Eric Matthes"
 *                             isbn: "9781593279288"
 *                             cover_url: "https://books.google.com/..."
 *                             available: true
 *       400:
 *         description: Missing or invalid message field
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized — missing or invalid Bearer token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded — AI provider is busy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Rate limit exceeded"
 *                 message:
 *                   type: string
 *                   example: "Hệ thống đang bận, vui lòng thử lại sau vài giây."
 *       500:
 *         description: AI service internal error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

    const hasImageContent =
      message.includes('data:image/') ||
      /\bdata:image\/[^;]+;base64,/i.test(message) ||
      /\bimage\/[^;\s]*/i.test(message);

    if (hasImageContent) {
      res.status(400).json({
        error: 'Image input not supported',
        message: 'Xin lỗi, tính năng này chỉ hỗ trợ tin nhắn văn bản. Không hỗ trợ gửi ảnh.',
      });
      return;
    }

    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const trimmedMessage = message.trim().toLowerCase();
    if (trimmedMessage === 'clipboard' || trimmedMessage === 'paste' || trimmedMessage === 'dán') {
      res.json({
        response: 'Xin lỗi, tôi không thể truy cập clipboard của bạn. Bạn vui lòng nhập nội dung trực tiếp bằng văn bản nhé.',
        requiresConfirmation: false,
        toolResults: undefined,
        sessionId: undefined,
        userRole: user.role,
      });
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

/**
 * @swagger
 * /ai/chat/sessions/{sessionId}:
 *   get:
 *     summary: Retrieve an AI chat session
 *     description: |
 *       Retrieve a previous AI chat session including message history and any pending confirmation state.
 *       Use this to restore conversation context after app restart or page reload.
 *     tags: [AI Assistant]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: The session ID returned by a previous chat call
 *         example: "sess_abc123xyz"
 *     responses:
 *       200:
 *         description: Session data with message history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId:
 *                   type: string
 *                   example: "sess_abc123xyz"
 *                 patronId:
 *                   type: string
 *                   example: "3f7a8b2c-1234-5678-abcd-ef0123456789"
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       role:
 *                         type: string
 *                         enum: [user, assistant]
 *                       content:
 *                         type: string
 *                       timestamp:
 *                         type: number
 *                         description: Unix timestamp in milliseconds
 *                 pendingConfirmation:
 *                   type: object
 *                   nullable: true
 *                   description: Pending action requiring user confirmation, or null
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Session not found or expired
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/sessions/:sessionId', (req: AuthRequest, res: Response) => {
  const { sessionId } = req.params;
  const user = req.user;

  if (!user) {
    res.status(401).json({ error: 'User not authenticated' });
    return;
  }

  const isStaff = user.role === 'admin' || user.role === 'staff';
  const patronId = isStaff ? undefined : user.userId;

  const session = patronId
    ? sessionStore.getOwned(sessionId, patronId)
    : sessionStore.get(sessionId);

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
