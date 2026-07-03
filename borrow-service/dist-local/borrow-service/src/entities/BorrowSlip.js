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
exports.BorrowSlip = void 0;
const typeorm_1 = require("typeorm");
let BorrowSlip = class BorrowSlip {
};
exports.BorrowSlip = BorrowSlip;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], BorrowSlip.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'patron_id', type: 'uuid' }),
    __metadata("design:type", String)
], BorrowSlip.prototype, "patronId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'borrow_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], BorrowSlip.prototype, "borrowAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'due_at', type: 'timestamp' }),
    __metadata("design:type", Date)
], BorrowSlip.prototype, "dueAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, default: 'active' }),
    __metadata("design:type", String)
], BorrowSlip.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_by_user_id', type: 'uuid', nullable: true }),
    __metadata("design:type", Object)
], BorrowSlip.prototype, "createdByUserId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_by_email', type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", Object)
], BorrowSlip.prototype, "createdByEmail", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'total_items', type: 'int', default: 0 }),
    __metadata("design:type", Number)
], BorrowSlip.prototype, "totalItems", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], BorrowSlip.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], BorrowSlip.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], BorrowSlip.prototype, "note", void 0);
exports.BorrowSlip = BorrowSlip = __decorate([
    (0, typeorm_1.Entity)({ name: 'borrow_slips' })
], BorrowSlip);
