"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sessions_1 = require("../sessions");
const tools_1 = require("../tools/tools");
const router = (0, express_1.Router)();
/**
 * @swagger
 * /ai/confirm:
 *   post:
 *     summary: Confirm or reject a pending AI action
 *     description: |
 *       When the AI assistant proposes a destructive or important action (e.g. extending a borrow period),
 *       it sets requiresConfirmation true in the chat response. The frontend should show a confirmation
 *       dialog and then call this endpoint with either approve or reject.
 *
 *       Workflow:
 *       1. User sends a message to POST /api/ai/chat
 *       2. Response has requiresConfirmation true and pendingAction with action details
 *       3. Frontend shows confirmation dialog
 *       4. User approves or rejects - call POST /api/ai/confirm
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
 *               - sessionId
 *               - action
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: "The session ID from the chat response that had requiresConfirmation true"
 *                 example: "sess_abc123xyz"
 *               action:
 *                 type: string
 *                 enum:
 *                   - approve
 *                   - reject
 *                 description: "Whether to approve or reject the pending action"
 *                 example: "approve"
 *     responses:
 *       200:
 *         description: Action approved and executed, or rejected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "Hanh dong da duoc thuc hien thanh cong."
 *                 result:
 *                   type: object
 *                   nullable: true
 *                   description: "Result data from executing the approved action"
 *       400:
 *         description: Missing fields, invalid action value, or no pending confirmation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Session not found or confirmation expired
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', async (req, res) => {
    try {
        const { sessionId, action } = req.body;
        if (!sessionId || !action) {
            res.status(400).json({ error: 'sessionId and action are required' });
            return;
        }
        if (!['approve', 'reject'].includes(action)) {
            res.status(400).json({ error: 'action must be "approve" or "reject"' });
            return;
        }
        const session = sessions_1.sessionStore.get(sessionId);
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
            sessions_1.sessionStore.setConfirmation(sessionId, undefined);
            res.json({
                success: true,
                message: 'Hành động đã bị từ chối.',
            });
            return;
        }
        try {
            const tool = tools_1.tools.find(t => t.name === pendingAction.toolName);
            if (tool) {
                const argValues = Object.values(pendingAction.toolArgs || {});
                const fn = tool.func;
                const result = await fn(...argValues);
                sessions_1.sessionStore.setConfirmation(sessionId, undefined);
                res.json({
                    success: true,
                    message: 'Hành động đã được thực hiện thành công.',
                    result,
                });
            }
            else {
                res.status(400).json({
                    success: false,
                    error: `Tool "${pendingAction.toolName}" not found`,
                });
            }
        }
        catch (error) {
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Execution failed',
            });
        }
    }
    catch (error) {
        console.error('Confirm error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
exports.default = router;
