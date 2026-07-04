import dotenv from 'dotenv';
dotenv.config();

function parsePostgresUrl(url: string) {
  const normalized = url.replace('postgresql+asyncpg://', 'postgresql://');
  const parsed = new URL(normalized);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '5432', 10),
    database: parsed.pathname.replace(/^\//, ''),
    username: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || 'postgres'),
  };
}

const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) {
  throw new Error('[Config] POSTGRES_URL must be set');
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`[Config] ${name} must be set`);
  return value;
}

export const config = {
  serviceName: process.env.SERVICE_NAME || 'borrow-service',
  port: parseInt(process.env.PORT || '8000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  postgres: parsePostgresUrl(postgresUrl),
  userServiceUrl: process.env.USER_SERVICE_URL || 'http://user-service:3001',
  accessServiceUrl: process.env.ACCESS_SERVICE_URL || 'http://access-service:3003',
  notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3006',
  serviceJwtSecret: requireEnv(process.env.SERVICE_JWT_SECRET, 'SERVICE_JWT_SECRET'),
  jwtSecret: requireEnv(process.env.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET'),
  jwtIssuer: process.env.JWT_ISSUER || 'face-recognition',
  jwtAudience: process.env.JWT_AUDIENCE || 'face-recognition-users',
  maxEntryHours: parseInt(process.env.PATRON_ACCESS_EXPIRY_HOURS || '24', 10),
  maxBorrowDays: parseInt(process.env.MAX_BORROW_DAYS || '14', 10),
  maxBorrowBooks: parseInt(process.env.MAX_BORROW_BOOKS || '3', 10),
  maxBorrowBooksPerSlip: parseInt(process.env.MAX_BORROW_BOOKS_PER_SLIP || '5', 10),
  finePerDay: parseFloat(process.env.FINE_PER_DAY || '5000'),
  maxRenewals: parseInt(process.env.MAX_RENEWALS || '1', 10),
};
