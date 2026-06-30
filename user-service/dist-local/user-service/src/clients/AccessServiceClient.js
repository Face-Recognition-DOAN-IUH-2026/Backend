"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accessServiceClient = void 0;
const config_1 = require("../config");
const shared_1 = require("../../../shared");
async function request(url, options = {}) {
    const { method = 'GET', body, timeout = 5000 } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${(0, shared_1.getServiceToken)('user-service', config_1.config.jwtSecret)}`,
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${text}`);
        }
        return res.json();
    }
    catch (error) {
        clearTimeout(timer);
        throw error;
    }
}
exports.accessServiceClient = {
    async getDailyStats() {
        const result = await request(`${config_1.config.accessServiceUrl}/internal/access/stats`);
        return {
            active_inside: result.active_inside ?? result.activeInside ?? 0,
            today_entries: result.today_entries || result.todayEntries || 0,
            today_exits: result.today_exits || result.todayExits || 0,
        };
    },
    async getPatronStatus(patronId) {
        try {
            const result = await request(`${config_1.config.accessServiceUrl}/internal/access/patrons/${encodeURIComponent(patronId)}/status`);
            return result.currentStatus || result.current_status || 'outside';
        }
        catch {
            return 'outside';
        }
    },
    async setPatronStatus(patronId, status, cameraId) {
        await request(`${config_1.config.accessServiceUrl}/internal/access/patrons/${encodeURIComponent(patronId)}/status`, {
            method: 'POST',
            body: { current_status: status, camera_id: cameraId || 'manual' },
        });
    },
};
