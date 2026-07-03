import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import { Book } from './entities/Book';
import { BookCopy } from './entities/BookCopy';
import { BorrowRecord } from './entities/BorrowRecord';
import { BorrowSlip } from './entities/BorrowSlip';
import { Waitlist } from './entities/Waitlist';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  username: config.postgres.username,
  password: config.postgres.password,
  entities: [Book, BookCopy, BorrowRecord, BorrowSlip, Waitlist],
  synchronize: true,
  logging: process.env.TYPEORM_LOGGING === 'true',
});
