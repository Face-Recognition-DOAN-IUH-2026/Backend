"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserServiceClient = void 0;
const config_1 = require("../config");
const errors_1 = require("../errors");
const shared_1 = require("../../../shared");
class UserServiceClient {
    constructor() {
        this.failures = 0;
        this.openedAt = 0;
        this.state = 'closed';
    }
    canRequest() {
        if (this.state !== 'open')
            return true;
        if (Date.now() - this.openedAt > 30000) {
            this.state = 'half_open';
            return true;
        }
        return false;
    }
    onSuccess() {
        this.failures = 0;
        this.state = 'closed';
    }
    onFailure() {
        this.failures += 1;
        if (this.failures >= 3) {
            this.state = 'open';
            this.openedAt = Date.now();
        }
    }
    async getJson(path) {
        if (!this.canRequest()) {
            throw new errors_1.ServiceUnavailableError('user-service is temporarily unavailable');
        }
        let lastError;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            try {
                const response = await fetch(`${config_1.config.userServiceUrl}${path}`, {
                    headers: { 'Authorization': `Bearer ${(0, shared_1.getServiceToken)('schedule-service', config_1.config.jwtSecret)}` },
                    signal: controller.signal,
                });
                clearTimeout(timeout);
                if (!response.ok) {
                    if (response.status === 404)
                        return null;
                    throw new Error(`user-service responded ${response.status}`);
                }
                this.onSuccess();
                return await response.json();
            }
            catch (err) {
                clearTimeout(timeout);
                lastError = err;
            }
        }
        this.onFailure();
        throw new errors_1.ServiceUnavailableError(`Cannot reach user-service: ${String(lastError)}`);
    }
    async getStaff(id) {
        return this.getJson(`/internal/users/${id}`);
    }
    async listStaff(ids) {
        const query = ids?.length ? `?ids=${encodeURIComponent(ids.join(','))}` : '';
        return this.getJson(`/internal/staff${query}`);
    }
    async requireActiveStaff(id) {
        const user = await this.getStaff(id);
        if (!user || !['staff', 'admin'].includes(user.role) || user.status !== 'active') {
            throw new errors_1.NotFoundError('Staff not found or inactive');
        }
        return user;
    }
}
exports.UserServiceClient = UserServiceClient;
