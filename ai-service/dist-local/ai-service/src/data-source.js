"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppDataSource = void 0;
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const config_1 = require("./config");
const AiInsight_1 = require("./entities/AiInsight");
const AiRun_1 = require("./entities/AiRun");
exports.AppDataSource = new typeorm_1.DataSource({
    type: 'postgres',
    host: config_1.config.db.host,
    port: config_1.config.db.port,
    database: config_1.config.db.database,
    username: config_1.config.db.user,
    password: config_1.config.db.password,
    entities: [AiInsight_1.AiInsight, AiRun_1.AiRun],
    migrations: process.env.TYPEORM_MIGRATION_RUN === 'true' ? ['migrations/*.{ts,js}'] : [],
    synchronize: false,
    logging: process.env.TYPEORM_LOGGING === 'true',
});
