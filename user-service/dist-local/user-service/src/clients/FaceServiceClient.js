"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.faceServiceClient = exports.FaceServiceClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const shared_1 = require("../../../shared");
class FaceServiceClient {
    constructor() {
        this.baseUrl = config_1.config.faceRecognitionServiceUrl || 'http://face-recognition-service:5000';
    }
    async checkEnrollment(userId) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/internal/face/${userId}/status`, {
                headers: { 'Authorization': `Bearer ${(0, shared_1.getServiceToken)('user-service', config_1.config.jwtSecret)}` },
                timeout: 5000,
            });
            return response.data.enrolled || false;
        }
        catch (error) {
            console.error(`[FaceServiceClient] Failed to check enrollment for user ${userId}:`, error);
            return false;
        }
    }
    async checkEnrollmentBatch(userIds) {
        if (userIds.length === 0)
            return {};
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/patrons/internal/batch-status`, { user_ids: userIds }, {
                headers: { 'Authorization': `Bearer ${(0, shared_1.getServiceToken)('user-service', config_1.config.jwtSecret)}` },
                timeout: 10000,
            });
            return response.data.statuses || {};
        }
        catch (error) {
            console.error('[FaceServiceClient] Batch enrollment check failed:', error);
            const fallback = {};
            for (const id of userIds)
                fallback[id] = false;
            return fallback;
        }
    }
}
exports.FaceServiceClient = FaceServiceClient;
exports.faceServiceClient = new FaceServiceClient();
