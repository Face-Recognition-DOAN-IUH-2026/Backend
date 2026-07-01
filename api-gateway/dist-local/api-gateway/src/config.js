"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PORT || '80', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    services: {
        faceRecognitionApi: process.env.FACE_RECOGNITION_API || 'http://face-recognition-api:8000',
        userService: process.env.USER_SERVICE || 'http://user-service:3001',
        borrowService: process.env.BORROW_SERVICE || 'http://borrow-service:8000',
        scheduleService: process.env.SCHEDULE_SERVICE || 'http://schedule-service:3002',
        accessService: process.env.ACCESS_SERVICE || 'http://access-service:3003',
        aiService: process.env.AI_SERVICE || 'http://ai-service:3004',
        notificationService: process.env.NOTIFICATION_SERVICE || 'http://notification-service:3006',
        automationService: process.env.AUTOMATION_SERVICE || 'http://automation-service:3007',
    },
    frontendUrl: process.env.FRONTEND_URL || 'http://host.docker.internal:3000',
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || [],
    rateLimit: {
        windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10),
        max: parseInt(process.env.API_RATE_LIMIT_MAX || (process.env.NODE_ENV === 'production' ? '600' : '5000'), 10),
    },
};
