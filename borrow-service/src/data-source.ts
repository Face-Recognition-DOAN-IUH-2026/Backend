import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import { Book } from './entities/Book';
import { BookCopy } from './entities/BookCopy';
import { BorrowRecord } from './entities/BorrowRecord';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  username: config.postgres.username,
  password: config.postgres.password,
  entities: [Book, BookCopy, BorrowRecord],
  synchronize: false,
  logging: process.env.TYPEORM_LOGGING === 'true',
});
