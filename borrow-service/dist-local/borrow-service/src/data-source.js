"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppDataSource = void 0;
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const config_1 = require("./config");
const Book_1 = require("./entities/Book");
const BookCopy_1 = require("./entities/BookCopy");
const BorrowRecord_1 = require("./entities/BorrowRecord");
const BorrowSlip_1 = require("./entities/BorrowSlip");
const BookReservation_1 = require("./entities/BookReservation");
const Waitlist_1 = require("./entities/Waitlist");
exports.AppDataSource = new typeorm_1.DataSource({
    type: 'postgres',
    host: config_1.config.postgres.host,
    port: config_1.config.postgres.port,
    database: config_1.config.postgres.database,
    username: config_1.config.postgres.username,
    password: config_1.config.postgres.password,
    entities: [Book_1.Book, BookCopy_1.BookCopy, BorrowRecord_1.BorrowRecord, BorrowSlip_1.BorrowSlip, BookReservation_1.BookReservation, Waitlist_1.Waitlist],
    synchronize: true,
    logging: process.env.TYPEORM_LOGGING === 'true',
});
