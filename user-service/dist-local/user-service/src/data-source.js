"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppDataSource = void 0;
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const config_1 = require("./config");
const User_entity_1 = require("./entities/User.entity");
exports.AppDataSource = new typeorm_1.DataSource({
    type: 'postgres',
    host: config_1.config.db.host,
    port: config_1.config.db.port,
    database: config_1.config.db.database,
    username: config_1.config.db.user,
    password: config_1.config.db.password,
    entities: [User_entity_1.User],
    migrations: ['migrations/*.{ts,js}'],
    synchronize: false,
    logging: process.env.TYPEORM_LOGGING === 'true',
    extra: {
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    },
});
