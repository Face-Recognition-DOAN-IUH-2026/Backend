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
exports.StaffAvailabilityRequest = void 0;
const typeorm_1 = require("typeorm");
let StaffAvailabilityRequest = class StaffAvailabilityRequest {
};
exports.StaffAvailabilityRequest = StaffAvailabilityRequest;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], StaffAvailabilityRequest.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'staff_id' }),
    __metadata("design:type", String)
], StaffAvailabilityRequest.prototype, "staffId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', name: 'date_from' }),
    __metadata("design:type", String)
], StaffAvailabilityRequest.prototype, "dateFrom", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', name: 'date_to' }),
    __metadata("design:type", String)
], StaffAvailabilityRequest.prototype, "dateTo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 30, default: 'unavailable' }),
    __metadata("design:type", String)
], StaffAvailabilityRequest.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], StaffAvailabilityRequest.prototype, "reason", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 30, default: 'pending' }),
    __metadata("design:type", String)
], StaffAvailabilityRequest.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true, name: 'reviewed_by' }),
    __metadata("design:type", Object)
], StaffAvailabilityRequest.prototype, "reviewedBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true, name: 'reviewed_at' }),
    __metadata("design:type", Object)
], StaffAvailabilityRequest.prototype, "reviewedAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], StaffAvailabilityRequest.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], StaffAvailabilityRequest.prototype, "updatedAt", void 0);
exports.StaffAvailabilityRequest = StaffAvailabilityRequest = __decorate([
    (0, typeorm_1.Index)(['staffId', 'status']),
    (0, typeorm_1.Entity)({ name: 'staff_availability_requests', schema: 'schedule' })
], StaffAvailabilityRequest);
