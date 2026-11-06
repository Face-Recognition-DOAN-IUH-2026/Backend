import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import { Book } from './entities/Book';
import { BookCopy } from './entities/BookCopy';
import { BookCopyConditionHistory } from './entities/BookCopyConditionHistory';
import { BorrowRecord } from './entities/BorrowRecord';
import { BorrowSlip } from './entities/BorrowSlip';
import { Waitlist } from './entities/Waitlist';
import { SystemConfig } from './entities/SystemConfig';
import { PaymentOrder } from './entities/PaymentOrder';
import { VietqrCallback } from './entities/VietqrCallback';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  username: config.postgres.username,
  password: config.postgres.password,
  entities: [
    Book,
    BookCopy,
    BookCopyConditionHistory,
    BorrowRecord,
    BorrowSlip,
    Waitlist,
    SystemConfig,
    PaymentOrder,
    VietqrCallback,
  ],
  synchronize: process.env.NODE_ENV === 'development',
  // When running from source (ts-node) load the TypeScript migrations; when running
  // the compiled build (container) load the compiled JavaScript. Mixing both globs
  // makes TypeORM try to require() .ts files, which fails at runtime.
  migrations: [
    __filename.endsWith('.ts')
      ? 'src/migrations/*.ts'
      : 'dist/borrow-service/src/migrations/*.js',
  ],
  logging: process.env.TYPEORM_LOGGING === 'true',
});
