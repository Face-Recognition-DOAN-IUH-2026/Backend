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
exports.ScheduleAuditLog = void 0;
const typeorm_1 = require("typeorm");
let ScheduleAuditLog = class ScheduleAuditLog {
};
exports.ScheduleAuditLog = ScheduleAuditLog;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], ScheduleAuditLog.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 80 }),
    __metadata("design:type", String)
], ScheduleAuditLog.prototype, "action", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 80, name: 'entity_type' }),
    __metadata("design:type", String)
], ScheduleAuditLog.prototype, "entityType", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true, name: 'entity_id' }),
    __metadata("design:type", Object)
], ScheduleAuditLog.prototype, "entityId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true, name: 'actor_id' }),
    __metadata("design:type", Object)
], ScheduleAuditLog.prototype, "actorId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100, nullable: true, name: 'actor_name' }),
    __metadata("design:type", Object)
], ScheduleAuditLog.prototype, "actorName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], ScheduleAuditLog.prototype, "metadata", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 45, nullable: true, name: 'ip_address' }),
    __metadata("design:type", Object)
], ScheduleAuditLog.prototype, "ipAddress", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true, name: 'user_agent' }),
    __metadata("design:type", Object)
], ScheduleAuditLog.prototype, "userAgent", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 500, nullable: true, name: 'request_path' }),
    __metadata("design:type", Object)
], ScheduleAuditLog.prototype, "requestPath", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], ScheduleAuditLog.prototype, "createdAt", void 0);
exports.ScheduleAuditLog = ScheduleAuditLog = __decorate([
    (0, typeorm_1.Entity)({ name: 'schedule_audit_logs', schema: 'schedule' })
], ScheduleAuditLog);
