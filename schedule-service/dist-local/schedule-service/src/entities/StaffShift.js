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
exports.StaffShift = void 0;
const typeorm_1 = require("typeorm");
let StaffShift = class StaffShift {
};
exports.StaffShift = StaffShift;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], StaffShift.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100 }),
    __metadata("design:type", String)
], StaffShift.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'time', name: 'start_time' }),
    __metadata("design:type", String)
], StaffShift.prototype, "startTime", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'time', name: 'end_time' }),
    __metadata("design:type", String)
], StaffShift.prototype, "endTime", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 1, name: 'min_staff' }),
    __metadata("design:type", Number)
], StaffShift.prototype, "minStaff", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true, name: 'max_staff' }),
    __metadata("design:type", Object)
], StaffShift.prototype, "maxStaff", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: true, name: 'is_active' }),
    __metadata("design:type", Boolean)
], StaffShift.prototype, "isActive", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], StaffShift.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], StaffShift.prototype, "updatedAt", void 0);
exports.StaffShift = StaffShift = __decorate([
    (0, typeorm_1.Entity)({ name: 'staff_shifts', schema: 'schedule' })
], StaffShift);
