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
exports.StaffSchedule = void 0;
const typeorm_1 = require("typeorm");
let StaffSchedule = class StaffSchedule {
};
exports.StaffSchedule = StaffSchedule;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], StaffSchedule.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'staff_id' }),
    __metadata("design:type", String)
], StaffSchedule.prototype, "staffId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'shift_id' }),
    __metadata("design:type", String)
], StaffSchedule.prototype, "shiftId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'zone_id' }),
    __metadata("design:type", String)
], StaffSchedule.prototype, "zoneId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', name: 'work_date' }),
    __metadata("design:type", String)
], StaffSchedule.prototype, "workDate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 30, default: 'scheduled' }),
    __metadata("design:type", String)
], StaffSchedule.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true, name: 'assigned_by' }),
    __metadata("design:type", Object)
], StaffSchedule.prototype, "assignedBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], StaffSchedule.prototype, "note", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], StaffSchedule.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], StaffSchedule.prototype, "updatedAt", void 0);
exports.StaffSchedule = StaffSchedule = __decorate([
    (0, typeorm_1.Index)(['staffId', 'workDate', 'status']),
    (0, typeorm_1.Entity)({ name: 'staff_schedules', schema: 'schedule' })
], StaffSchedule);
