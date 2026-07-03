import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import { Notification } from './entities/Notification';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  username: config.db.user,
  password: config.db.password,
  entities: [Notification],
  synchronize: true,
  logging: process.env.TYPEORM_LOGGING === 'true',
});
