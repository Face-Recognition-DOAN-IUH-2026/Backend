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
exports.StaffShiftPreference = void 0;
const typeorm_1 = require("typeorm");
let StaffShiftPreference = class StaffShiftPreference {
};
exports.StaffShiftPreference = StaffShiftPreference;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], StaffShiftPreference.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'staff_id' }),
    __metadata("design:type", String)
], StaffShiftPreference.prototype, "staffId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'shift_id' }),
    __metadata("design:type", String)
], StaffShiftPreference.prototype, "shiftId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'zone_id' }),
    __metadata("design:type", String)
], StaffShiftPreference.prototype, "zoneId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 1 }),
    __metadata("design:type", Number)
], StaffShiftPreference.prototype, "priority", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: true, name: 'is_active' }),
    __metadata("design:type", Boolean)
], StaffShiftPreference.prototype, "isActive", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], StaffShiftPreference.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], StaffShiftPreference.prototype, "updatedAt", void 0);
exports.StaffShiftPreference = StaffShiftPreference = __decorate([
    (0, typeorm_1.Entity)({ name: 'staff_shift_preferences', schema: 'schedule' })
], StaffShiftPreference);
