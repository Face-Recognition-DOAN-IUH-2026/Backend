"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffScheduleAutoCheckout = staffScheduleAutoCheckout;
const shared_1 = require("../../../shared");
async function staffScheduleAutoCheckout(config) {
    const url = `${config.services?.scheduleService || 'http://schedule-service:3002'}/schedules/internal/auto-checkout`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${(0, shared_1.getServiceToken)('automation-service', config.jwtSecret)}`,
            },
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const result = await res.json();
        return {
            checked: 1,
            success: true,
            result,
            message: `Auto-checkout completed: ${JSON.stringify(result)}`,
        };
    }
    catch (error) {
        clearTimeout(timer);
        if (error.name === 'AbortError') {
            throw new Error('Auto-checkout request timed out after 30s');
        }
        throw error;
    }
}
