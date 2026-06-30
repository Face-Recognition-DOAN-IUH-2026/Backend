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
exports.Waitlist = void 0;
const typeorm_1 = require("typeorm");
const Book_1 = require("./Book");
let Waitlist = class Waitlist {
};
exports.Waitlist = Waitlist;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Waitlist.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'book_id', type: 'uuid' }),
    __metadata("design:type", String)
], Waitlist.prototype, "bookId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'patron_id', type: 'uuid' }),
    __metadata("design:type", String)
], Waitlist.prototype, "patronId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, default: 'waiting' }),
    __metadata("design:type", String)
], Waitlist.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'notified_at', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], Waitlist.prototype, "notifiedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], Waitlist.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => Book_1.Book, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'book_id' }),
    __metadata("design:type", Book_1.Book)
], Waitlist.prototype, "book", void 0);
exports.Waitlist = Waitlist = __decorate([
    (0, typeorm_1.Entity)({ name: 'waitlists' })
], Waitlist);
