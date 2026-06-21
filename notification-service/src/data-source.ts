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
  migrations: ['dist/migrations/*.{ts,js}'],
  synchronize: false,
  logging: process.env.TYPEORM_LOGGING === 'true',
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
});
