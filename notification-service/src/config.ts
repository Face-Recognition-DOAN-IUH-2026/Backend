import dotenv from 'dotenv';
dotenv.config();

// Validate required secrets at startup
const jwtSecret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const internalApiKey = process.env.INTERNAL_API_KEY;

if (!jwtSecret) {
  throw new Error('[Config] JWT_SECRET or JWT_ACCESS_SECRET must be set');
}
if (!internalApiKey) {
  throw new Error('[Config] INTERNAL_API_KEY must be set');
}

export const config = {
  port: parseInt(process.env.PORT || '3006', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret,
  jwtIssuer: process.env.JWT_ISSUER || 'face-recognition',
  jwtAudience: process.env.JWT_AUDIENCE || 'face-recognition-users',
  internalApiKey,
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379/0',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'notificationdb',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || [],
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Thu Vien IUH <noreply@iuh.edu.vn>',
  },
};
