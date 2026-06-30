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
exports.StaffScheduleTemplate = void 0;
const typeorm_1 = require("typeorm");
let StaffScheduleTemplate = class StaffScheduleTemplate {
};
exports.StaffScheduleTemplate = StaffScheduleTemplate;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], StaffScheduleTemplate.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100 }),
    __metadata("design:type", String)
], StaffScheduleTemplate.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', name: 'day_of_week' }),
    __metadata("design:type", Number)
], StaffScheduleTemplate.prototype, "dayOfWeek", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'shift_id' }),
    __metadata("design:type", String)
], StaffScheduleTemplate.prototype, "shiftId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'zone_id' }),
    __metadata("design:type", String)
], StaffScheduleTemplate.prototype, "zoneId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'staff_id' }),
    __metadata("design:type", String)
], StaffScheduleTemplate.prototype, "staffId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: true, name: 'is_active' }),
    __metadata("design:type", Boolean)
], StaffScheduleTemplate.prototype, "isActive", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true, name: 'valid_from' }),
    __metadata("design:type", Object)
], StaffScheduleTemplate.prototype, "validFrom", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true, name: 'valid_to' }),
    __metadata("design:type", Object)
], StaffScheduleTemplate.prototype, "validTo", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], StaffScheduleTemplate.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], StaffScheduleTemplate.prototype, "updatedAt", void 0);
exports.StaffScheduleTemplate = StaffScheduleTemplate = __decorate([
    (0, typeorm_1.Entity)({ name: 'staff_schedule_templates', schema: 'schedule' })
], StaffScheduleTemplate);
