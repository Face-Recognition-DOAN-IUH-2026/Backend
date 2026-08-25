import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import { AiInsight } from './entities/AiInsight';
import { AiMemory } from './entities/AiMemory';
import { AiRun } from './entities/AiRun';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  username: config.db.user,
  password: config.db.password,
  entities: [AiInsight, AiMemory, AiRun],
  migrations: process.env.TYPEORM_MIGRATION_RUN === 'true' ? ['migrations/*.{ts,js}'] : [],
  synchronize: false,
  logging: process.env.TYPEORM_LOGGING === 'true',
});
