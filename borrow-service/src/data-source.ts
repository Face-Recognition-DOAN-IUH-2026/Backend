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
  ],
  synchronize: process.env.NODE_ENV === 'development',
  logging: process.env.TYPEORM_LOGGING === 'true',
});
