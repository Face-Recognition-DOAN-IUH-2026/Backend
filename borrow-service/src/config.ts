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

const postgresUrl = process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/borrowdb';

export const config = {
  serviceName: process.env.SERVICE_NAME || 'borrow-service',
  port: parseInt(process.env.PORT || '8000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  postgres: parsePostgresUrl(postgresUrl),
  userServiceUrl: process.env.USER_SERVICE_URL || 'http://user-service:3001',
  accessServiceUrl: process.env.ACCESS_SERVICE_URL || 'http://access-service:3003',
  internalApiKey: process.env.INTERNAL_API_KEY || 'change-me-in-production',
  jwtSecret: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'change-me-in-production',
  jwtIssuer: process.env.JWT_ISSUER || 'face-recognition',
  jwtAudience: process.env.JWT_AUDIENCE || 'face-recognition-users',
  maxEntryHours: parseInt(process.env.PATRON_ACCESS_EXPIRY_HOURS || '24', 10),
  maxBorrowDays: parseInt(process.env.MAX_BORROW_DAYS || '14', 10),
  maxBorrowBooks: parseInt(process.env.MAX_BORROW_BOOKS || '3', 10),
  maxBorrowBooksPerSlip: parseInt(process.env.MAX_BORROW_BOOKS_PER_SLIP || '5', 10),
};
