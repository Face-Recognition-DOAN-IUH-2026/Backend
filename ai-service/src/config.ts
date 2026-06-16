import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3004', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'your-secret-key-change-in-production',
  jwtIssuer: process.env.JWT_ISSUER || 'face-recognition',
  jwtAudience: process.env.JWT_AUDIENCE || 'face-recognition-users',
  internalApiKey: process.env.INTERNAL_API_KEY || 'change-me-in-production',
  accessServiceUrl: process.env.ACCESS_SERVICE_URL || 'http://access-service:3003',
  borrowServiceUrl: process.env.BORROW_SERVICE_URL || 'http://borrow-service:8000',
  scheduleServiceUrl: process.env.SCHEDULE_SERVICE_URL || 'http://schedule-service:3002',
  userServiceUrl: process.env.USER_SERVICE_URL || 'http://user-service:3001',
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini',
    baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
  },
  ai: {
    refreshMinutes: parseInt(process.env.AI_REFRESH_MINUTES || '15', 10),
    mockMode: (process.env.AI_MOCK_MODE || 'false').toLowerCase() === 'true',
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'aidb',
    schema: process.env.DB_SCHEMA || 'ai',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
};
