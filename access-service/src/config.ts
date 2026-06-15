import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'your-secret-key-change-in-production',
  jwtIssuer: process.env.JWT_ISSUER || 'face-recognition',
  jwtAudience: process.env.JWT_AUDIENCE || 'face-recognition-users',
  internalApiKey: process.env.INTERNAL_API_KEY || 'change-me-in-production',
  userServiceUrl: process.env.USER_SERVICE_URL || 'http://user-service:3001',
  redisUrl: process.env.REDIS_URL || '',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'face_recognition',
    schema: process.env.DB_SCHEMA || 'access',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
};
