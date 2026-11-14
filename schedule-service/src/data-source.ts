import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import {
  LibraryZone,
  StaffShift,
  StaffScheduleTemplate,
  StaffSchedule,
  StaffAttendance,
  ScheduleAuditLog,
  GeofenceConfig,
  StaffShiftPreference,
} from './entities';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  username: config.db.user,
  password: config.db.password,
  entities: [
    LibraryZone,
    StaffShift,
    StaffScheduleTemplate,
    StaffSchedule,
    StaffAttendance,
    ScheduleAuditLog,
    GeofenceConfig,
    StaffShiftPreference,
  ],
  migrations: process.env.TYPEORM_MIGRATION_RUN === 'true' ? ['migrations/*.{ts,js}'] : [],
  synchronize: process.env.NODE_ENV === 'development',
  logging: process.env.TYPEORM_LOGGING === 'true',
  extra: {
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
});
