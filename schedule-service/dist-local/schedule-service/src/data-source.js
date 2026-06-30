"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppDataSource = void 0;
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const config_1 = require("./config");
const entities_1 = require("./entities");
exports.AppDataSource = new typeorm_1.DataSource({
    type: 'postgres',
    host: config_1.config.db.host,
    port: config_1.config.db.port,
    database: config_1.config.db.database,
    username: config_1.config.db.user,
    password: config_1.config.db.password,
    entities: [
        entities_1.LibraryZone,
        entities_1.StaffShift,
        entities_1.StaffAvailabilityRequest,
        entities_1.StaffScheduleTemplate,
        entities_1.StaffSchedule,
        entities_1.StaffAttendance,
        entities_1.ScheduleAuditLog,
        entities_1.ShiftBid,
        entities_1.ShiftSwap,
        entities_1.GeofenceConfig,
        entities_1.StaffShiftPreference,
    ],
    migrations: process.env.TYPEORM_MIGRATION_RUN === 'true' ? ['migrations/*.{ts,js}'] : [],
    synchronize: process.env.NODE_ENV !== 'production',
    logging: process.env.TYPEORM_LOGGING === 'true',
});
