import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import { LibraryZone } from './entities/LibraryZone';
import { StaffShift } from './entities/StaffShift';
import { StaffAvailabilityRequest } from './entities/StaffAvailabilityRequest';
import { StaffScheduleTemplate } from './entities/StaffScheduleTemplate';
import { StaffSchedule } from './entities/StaffSchedule';
import { StaffAttendance } from './entities/StaffAttendance';
import { ScheduleAuditLog } from './entities/ScheduleAuditLog';

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
  ],
  migrations: process.env.TYPEORM_MIGRATION_RUN === 'true' ? ['migrations/*.{ts,js}'] : [],
  synchronize: false,
  logging: process.env.TYPEORM_LOGGING === 'true',
});
