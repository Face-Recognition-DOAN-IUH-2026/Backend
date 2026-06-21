import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || '',
  jwtIssuer: process.env.JWT_ISSUER || 'face-recognition',
  jwtAudience: process.env.JWT_AUDIENCE || 'face-recognition-users',
  jwtAccessExpiresMinutes: parseInt(process.env.JWT_ACCESS_EXPIRES_MINUTES || '15', 10),
  jwtRefreshExpiresDays: parseInt(process.env.JWT_REFRESH_EXPIRES_DAYS || '30', 10),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'face_recognition',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379/0',
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  borrowServiceUrl: process.env.BORROW_SERVICE_URL || 'http://borrow-service:8000',
};