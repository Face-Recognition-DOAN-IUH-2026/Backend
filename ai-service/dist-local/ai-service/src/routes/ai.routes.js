"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const shared_1 = require("../../../shared");
const config_1 = require("../config");
const AiService_1 = require("../services/AiService");
const auth = (0, shared_1.createAuth)({
    jwtSecret: config_1.config.jwtSecret,
    jwtAudience: config_1.config.jwtAudience,
    jwtIssuer: config_1.config.jwtIssuer,
});
const router = (0, express_1.Router)();
const asyncHandler = (fn) => (req, res, next) => {
    fn(req, res, next).catch(next);
};
router.use(auth);
/**
 * @swagger
 * /ai/command-center/summary:
 *   get:
 *     summary: Get AI command center summary (cached)
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved AI summary
 */
router.get('/command-center/summary', (0, shared_1.requireRole)(['admin', 'staff']), asyncHandler(async (req, res) => {
    res.json(await AiService_1.aiService.getSummary(req.user.token || '', false));
}));
/**
 * @swagger
 * /ai/command-center/refresh:
 *   post:
 *     summary: Force refresh AI command center summary
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully refreshed AI summary
 */
router.post('/command-center/refresh', (0, shared_1.requireRole)(['admin', 'staff']), asyncHandler(async (req, res) => {
    res.json(await AiService_1.aiService.getSummary(req.user.token || '', true));
}));
/**
 * @swagger
 * /ai/insights:
 *   get:
 *     summary: List AI insights with optional filters
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by insight status
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by insight category
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *         description: Filter by insight severity
 *     responses:
 *       200:
 *         description: Successfully retrieved insights list
 */
router.get('/insights', (0, shared_1.requireRole)(['admin', 'staff']), asyncHandler(async (req, res) => {
    res.json(await AiService_1.aiService.listInsights({
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
        severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
    }));
}));
/**
 * @swagger
 * /ai/insights/{id}/dismiss:
 *   post:
 *     summary: Dismiss an AI insight
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Insight UUID
 *     responses:
 *       200:
 *         description: Successfully dismissed insight
 */
router.post('/insights/:id/dismiss', (0, shared_1.requireRole)(['admin', 'staff']), asyncHandler(async (req, res) => {
    const { id } = zod_1.z.object({ id: zod_1.z.string().uuid() }).parse(req.params);
    res.json(await AiService_1.aiService.dismissInsight(id));
}));
/**
 * @swagger
 * /ai/insights/{id}/explain:
 *   get:
 *     summary: Get AI explanation for an insight
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Insight UUID
 *     responses:
 *       200:
 *         description: Successfully retrieved insight explanation
 */
router.get('/insights/:id/explain', (0, shared_1.requireRole)(['admin', 'staff']), asyncHandler(async (req, res) => {
    const { id } = zod_1.z.object({ id: zod_1.z.string().uuid() }).parse(req.params);
    res.json(await AiService_1.aiService.explainInsight(id));
}));
/**
 * @swagger
 * /ai/command-center/chat:
 *   post:
 *     summary: Send a chat message to the AI command center
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: "Chat message payload"
 *     responses:
 *       200:
 *         description: Successfully received AI chat response
 */
router.post('/command-center/chat', (0, shared_1.requireRole)(['admin', 'staff']), asyncHandler(async (req, res) => {
    res.json(await AiService_1.aiService.chat(req.user.token || '', req.body));
}));
/**
 * @swagger
 * /ai/recommendations/patron/{studentCode}:
 *   get:
 *     summary: Get AI book recommendations for a patron
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Patron student code
 *     responses:
 *       200:
 *         description: Successfully retrieved book recommendations
 */
router.get('/recommendations/patron/:studentCode', asyncHandler(async (req, res) => {
    res.json(await AiService_1.aiService.recommendBooks(req.user.token || '', req.params.studentCode));
}));
exports.default = router;
