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
exports.AutomationTask = void 0;
const typeorm_1 = require("typeorm");
let AutomationTask = class AutomationTask {
};
exports.AutomationTask = AutomationTask;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], AutomationTask.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100, unique: true }),
    __metadata("design:type", String)
], AutomationTask.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], AutomationTask.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20 }),
    __metadata("design:type", String)
], AutomationTask.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cron_expression', type: 'varchar', length: 50, nullable: true }),
    __metadata("design:type", Object)
], AutomationTask.prototype, "cronExpression", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'event_type', type: 'varchar', length: 50, nullable: true }),
    __metadata("design:type", Object)
], AutomationTask.prototype, "eventType", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100 }),
    __metadata("design:type", String)
], AutomationTask.prototype, "handler", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], AutomationTask.prototype, "config", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'is_active', type: 'boolean', default: true }),
    __metadata("design:type", Boolean)
], AutomationTask.prototype, "isActive", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'last_run_at', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], AutomationTask.prototype, "lastRunAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'next_run_at', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], AutomationTask.prototype, "nextRunAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], AutomationTask.prototype, "createdAt", void 0);
exports.AutomationTask = AutomationTask = __decorate([
    (0, typeorm_1.Entity)({ name: 'automation_tasks' })
], AutomationTask);
