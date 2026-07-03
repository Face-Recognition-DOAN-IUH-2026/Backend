"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ScheduleService_1 = require("../services/ScheduleService");
const config_1 = require("../config");
const shared_1 = require("../../../shared");
const internalAuth = (0, shared_1.createInternalAuth)({
    serviceName: 'schedule-service',
    jwtSecret: config_1.config.serviceJwtSecret,
});
const router = (0, express_1.Router)();
router.use(internalAuth);
router.get('/today', async (req, res) => {
    try {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const assignments = await ScheduleService_1.scheduleService.listAssignments({
            from: dateStr,
            to: dateStr,
        });
        res.json(assignments);
    }
    catch (error) {
        console.error('Error fetching today schedule:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/upcoming', internalAuth, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) {
            res.status(400).json({ error: 'Missing from or to query parameter (YYYY-MM-DD)' });
            return;
        }
        const assignments = await ScheduleService_1.scheduleService.listAssignments({
            from: from,
            to: to,
        });
        res.json(assignments);
    }
    catch (error) {
        console.error('Error fetching upcoming schedule:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/auto-checkout', internalAuth, async (req, res) => {
    try {
        const result = await ScheduleService_1.scheduleService.autoCheckoutStaleAssignments();
        res.json(result);
    }
    catch (error) {
        console.error('Error auto-checking out stale assignments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/expire-stale-bids', internalAuth, async (_req, res) => {
    try {
        const result = await ScheduleService_1.scheduleService.expireStaleBidsInternal();
        res.json(result);
    }
    catch (error) {
        console.error('Error expiring stale bids:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/expire-stale-swaps', internalAuth, async (_req, res) => {
    try {
        const result = await ScheduleService_1.scheduleService.expireStaleSwapsInternal();
        res.json(result);
    }
    catch (error) {
        console.error('Error expiring stale swaps:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
