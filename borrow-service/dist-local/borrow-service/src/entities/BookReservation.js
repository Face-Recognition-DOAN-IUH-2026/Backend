"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookReservation = void 0;
const typeorm_1 = require("typeorm");
const Book_1 = require("./Book");
let BookReservation = class BookReservation {
};
exports.BookReservation = BookReservation;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], BookReservation.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'patron_id', type: 'uuid' }),
    __metadata("design:type", String)
], BookReservation.prototype, "patronId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'book_id', type: 'uuid' }),
    __metadata("design:type", String)
], BookReservation.prototype, "bookId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reserved_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], BookReservation.prototype, "reservedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'expires_at', type: 'timestamp' }),
    __metadata("design:type", Date)
], BookReservation.prototype, "expiresAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, default: 'pending' }),
    __metadata("design:type", String)
], BookReservation.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'notified_at', type: 'timestamp', nullable: true }),
    __metadata("design:type", Object)
], BookReservation.prototype, "notifiedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], BookReservation.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => Book_1.Book),
    (0, typeorm_1.JoinColumn)({ name: 'book_id' }),
    __metadata("design:type", Book_1.Book)
], BookReservation.prototype, "book", void 0);
exports.BookReservation = BookReservation = __decorate([
    (0, typeorm_1.Entity)({ name: 'book_reservations' })
], BookReservation);
