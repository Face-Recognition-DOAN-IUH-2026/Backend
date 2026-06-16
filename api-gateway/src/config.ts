import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '80', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  services: {
    faceRecognitionApi: process.env.FACE_RECOGNITION_API || 'http://face-recognition-api:8000',
    userService: process.env.USER_SERVICE || 'http://user-service:3001',
    borrowService: process.env.BORROW_SERVICE || 'http://borrow-service:8000',
    scheduleService: process.env.SCHEDULE_SERVICE || 'http://schedule-service:3002',
    accessService: process.env.ACCESS_SERVICE || 'http://access-service:3003',
    aiService: process.env.AI_SERVICE || 'http://ai-service:3004',
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://host.docker.internal:3000',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
  rateLimit: {
    windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.API_RATE_LIMIT_MAX || (process.env.NODE_ENV === 'production' ? '600' : '5000'), 10),
  },
};
