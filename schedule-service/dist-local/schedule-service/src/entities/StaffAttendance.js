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
exports.StaffAttendance = void 0;
const typeorm_1 = require("typeorm");
let StaffAttendance = class StaffAttendance {
};
exports.StaffAttendance = StaffAttendance;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], StaffAttendance.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'schedule_id' }),
    __metadata("design:type", String)
], StaffAttendance.prototype, "scheduleId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'staff_id' }),
    __metadata("design:type", String)
], StaffAttendance.prototype, "staffId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true, name: 'check_in_at' }),
    __metadata("design:type", Object)
], StaffAttendance.prototype, "checkInAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true, name: 'check_out_at' }),
    __metadata("design:type", Object)
], StaffAttendance.prototype, "checkOutAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 30 }),
    __metadata("design:type", String)
], StaffAttendance.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 30, default: 'web' }),
    __metadata("design:type", String)
], StaffAttendance.prototype, "method", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100, nullable: true, name: 'invalidated_reason' }),
    __metadata("design:type", Object)
], StaffAttendance.prototype, "invalidatedReason", void 0);
__decorate([
    (0, typeorm_1.DeleteDateColumn)({ name: 'deleted_at', nullable: true }),
    __metadata("design:type", Object)
], StaffAttendance.prototype, "deletedAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], StaffAttendance.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], StaffAttendance.prototype, "updatedAt", void 0);
exports.StaffAttendance = StaffAttendance = __decorate([
    (0, typeorm_1.Index)(['scheduleId']),
    (0, typeorm_1.Index)(['staffId', 'checkInAt']),
    (0, typeorm_1.Entity)({ name: 'staff_attendance', schema: 'schedule' })
], StaffAttendance);
