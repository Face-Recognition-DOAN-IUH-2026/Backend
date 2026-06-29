import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3007', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || '',
  jwtIssuer: process.env.JWT_ISSUER || 'face-recognition',
  jwtAudience: process.env.JWT_AUDIENCE || 'face-recognition-users',
  serviceJwtSecret: process.env.SERVICE_JWT_SECRET || '',
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379/0',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'automationdb',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  services: {
    notificationService: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3006',
    borrowService: process.env.BORROW_SERVICE_URL || 'http://borrow-service:8000',
    scheduleService: process.env.SCHEDULE_SERVICE_URL || 'http://schedule-service:3002',
    accessService: process.env.ACCESS_SERVICE_URL || 'http://access-service:3003',
    userService: process.env.USER_SERVICE_URL || 'http://user-service:3001',
  },
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || [],
};
