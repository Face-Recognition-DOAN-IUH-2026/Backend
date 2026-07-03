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
exports.ShiftBid = void 0;
const typeorm_1 = require("typeorm");
let ShiftBid = class ShiftBid {
};
exports.ShiftBid = ShiftBid;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], ShiftBid.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'staff_id' }),
    __metadata("design:type", String)
], ShiftBid.prototype, "staffId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'assignment_id' }),
    __metadata("design:type", String)
], ShiftBid.prototype, "assignmentId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, default: 'pending' }),
    __metadata("design:type", String)
], ShiftBid.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], ShiftBid.prototype, "note", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true, name: 'reviewed_by' }),
    __metadata("design:type", Object)
], ShiftBid.prototype, "reviewedBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true, name: 'reviewed_at' }),
    __metadata("design:type", Object)
], ShiftBid.prototype, "reviewedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false, name: 'notified_expiring' }),
    __metadata("design:type", Boolean)
], ShiftBid.prototype, "notifiedExpiring", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], ShiftBid.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], ShiftBid.prototype, "updatedAt", void 0);
exports.ShiftBid = ShiftBid = __decorate([
    (0, typeorm_1.Entity)({ name: 'shift_bids', schema: 'schedule' })
], ShiftBid);
