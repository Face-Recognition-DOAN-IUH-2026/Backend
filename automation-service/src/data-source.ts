import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import { AutomationTask } from './entities/AutomationTask';
import { AutomationRun } from './entities/AutomationRun';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  username: config.db.user,
  password: config.db.password,
  entities: [AutomationTask, AutomationRun],
  migrations: ['dist/migrations/*.{ts,js}'],
  synchronize: false,
  logging: process.env.TYPEORM_LOGGING === 'true',
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
});
