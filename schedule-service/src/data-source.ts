import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import {
  LibraryZone,
  StaffShift,
  StaffAvailabilityRequest,
  StaffScheduleTemplate,
  StaffSchedule,
  StaffAttendance,
  ScheduleAuditLog,
  ShiftBid,
  ShiftSwap,
  GeofenceConfig,
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
    StaffAvailabilityRequest,
    StaffScheduleTemplate,
    StaffSchedule,
    StaffAttendance,
    ScheduleAuditLog,
    ShiftBid,
    ShiftSwap,
    GeofenceConfig,
  ],
  migrations: process.env.TYPEORM_MIGRATION_RUN === 'true' ? ['migrations/*.{ts,js}'] : [],
  synchronize: true,
  logging: process.env.TYPEORM_LOGGING === 'true',
});
