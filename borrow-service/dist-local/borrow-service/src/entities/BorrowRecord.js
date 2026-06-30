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
exports.BorrowRecord = void 0;
const typeorm_1 = require("typeorm");
const Book_1 = require("./Book");
const BookCopy_1 = require("./BookCopy");
let BorrowRecord = class BorrowRecord {
};
exports.BorrowRecord = BorrowRecord;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], BorrowRecord.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'patron_id', type: 'uuid' }),
    __metadata("design:type", String)
], BorrowRecord.prototype, "patronId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'book_id', type: 'uuid' }),
    __metadata("design:type", String)
], BorrowRecord.prototype, "bookId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'copy_id', type: 'uuid', nullable: true }),
    __metadata("design:type", Object)
], BorrowRecord.prototype, "copyId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'borrow_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], BorrowRecord.prototype, "borrowAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'return_at', type: 'timestamp', nullable: true }),
    __metadata("design:type", Object)
], BorrowRecord.prototype, "returnAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'due_at', type: 'timestamp' }),
    __metadata("design:type", Date)
], BorrowRecord.prototype, "dueAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'shelf_location', type: 'varchar', length: 100, nullable: true }),
    __metadata("design:type", Object)
], BorrowRecord.prototype, "shelfLocation", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, default: 'borrowed' }),
    __metadata("design:type", String)
], BorrowRecord.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'returned_by_user_id', type: 'uuid', nullable: true }),
    __metadata("design:type", Object)
], BorrowRecord.prototype, "returnedByUserId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'returned_by_email', type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", Object)
], BorrowRecord.prototype, "returnedByEmail", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'return_method', type: 'varchar', length: 50, nullable: true }),
    __metadata("design:type", Object)
], BorrowRecord.prototype, "returnMethod", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'slip_id', type: 'uuid', nullable: true }),
    __metadata("design:type", Object)
], BorrowRecord.prototype, "slipId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'note', type: 'text', nullable: true }),
    __metadata("design:type", Object)
], BorrowRecord.prototype, "note", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fine_amount', type: 'decimal', precision: 10, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], BorrowRecord.prototype, "fineAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fine_paid', type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], BorrowRecord.prototype, "finePaid", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'renewal_count', type: 'int', default: 0 }),
    __metadata("design:type", Number)
], BorrowRecord.prototype, "renewalCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], BorrowRecord.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], BorrowRecord.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => Book_1.Book),
    (0, typeorm_1.JoinColumn)({ name: 'book_id' }),
    __metadata("design:type", Book_1.Book)
], BorrowRecord.prototype, "book", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => BookCopy_1.BookCopy, { nullable: true }),
    (0, typeorm_1.JoinColumn)({ name: 'copy_id' }),
    __metadata("design:type", Object)
], BorrowRecord.prototype, "copy", void 0);
exports.BorrowRecord = BorrowRecord = __decorate([
    (0, typeorm_1.Index)(['patronId', 'status']),
    (0, typeorm_1.Index)(['bookId', 'status']),
    (0, typeorm_1.Index)(['borrowAt']),
    (0, typeorm_1.Index)(['slipId']),
    (0, typeorm_1.Entity)({ name: 'borrow_records' })
], BorrowRecord);
