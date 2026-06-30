"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffScheduleExpireStaleBids = staffScheduleExpireStaleBids;
const config_1 = require("../config");
const shared_1 = require("../../../shared");
async function staffScheduleExpireStaleBids(taskConfig) {
    const url = `${config_1.config.services?.scheduleService || 'http://schedule-service:3002'}/schedules/internal/expire-stale-bids`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${(0, shared_1.getServiceToken)('automation-service', config_1.config.jwtSecret)}`,
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
            message: `Expire stale bids completed: ${JSON.stringify(result)}`,
        };
    }
    catch (error) {
        clearTimeout(timer);
        if (error.name === 'AbortError') {
            throw new Error('Expire stale bids request timed out after 30s');
        }
        throw error;
    }
}
