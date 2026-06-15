import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import { AccessLog } from './entities/AccessLog';
import { PatronAccessState } from './entities/PatronAccessState';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  username: config.db.user,
  password: config.db.password,
  entities: [AccessLog, PatronAccessState],
  migrations: process.env.TYPEORM_MIGRATION_RUN === 'true' ? ['migrations/*.ts'] : [],
  synchronize: false,
  logging: process.env.TYPEORM_LOGGING === 'true',
});
