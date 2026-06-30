"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const shared_1 = require("../../../shared");
const config_1 = require("../config");
const data_source_1 = require("../data-source");
const AutomationTask_1 = require("../entities/AutomationTask");
const AutomationRun_1 = require("../entities/AutomationRun");
const EventBus_1 = require("../events/EventBus");
const internalAuth = (0, shared_1.createInternalAuth)({
    serviceName: 'automation-service',
    jwtSecret: config_1.config.serviceJwtSecret,
});
const taskRepo = () => data_source_1.AppDataSource.getRepository(AutomationTask_1.AutomationTask);
const runRepo = () => data_source_1.AppDataSource.getRepository(AutomationRun_1.AutomationRun);
const router = (0, express_1.Router)();
router.use(internalAuth);
router.get('/tasks', async (req, res, next) => {
    try {
        const tasks = await taskRepo().find({ order: { createdAt: 'DESC' } });
        res.json(tasks);
    }
    catch (error) {
        next(error);
    }
});
router.get('/runs', async (req, res, next) => {
    try {
        const taskId = req.query.taskId;
        const limit = parseInt(req.query.limit) || 20;
        const where = taskId ? { taskId } : {};
        const runs = await runRepo().find({ where, order: { startedAt: 'DESC' }, take: limit });
        res.json(runs);
    }
    catch (error) {
        next(error);
    }
});
router.post('/events', async (req, res, next) => {
    try {
        const { type, payload } = req.body;
        if (!type || !payload) {
            res.status(400).json({ error: 'type and payload are required' });
            return;
        }
        await EventBus_1.eventBus.publish({ type, payload, timestamp: new Date().toISOString() });
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
