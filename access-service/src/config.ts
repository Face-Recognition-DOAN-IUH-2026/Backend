import dotenv from 'dotenv';
dotenv.config();
import { requireServiceSecret } from '../../shared/config';

export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || '',
  jwtIssuer: process.env.JWT_ISSUER || 'face-recognition',
  jwtAudience: process.env.JWT_AUDIENCE || 'face-recognition-users',
  serviceJwtSecret: requireServiceSecret(process.env.SERVICE_JWT_SECRET, process.env.NODE_ENV || 'development'),
  userServiceUrl: process.env.USER_SERVICE_URL || 'http://user-service:3001',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'face_recognition',
    schema: process.env.DB_SCHEMA || 'access',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || [],
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379/0',
};
