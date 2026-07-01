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
exports.AiRun = void 0;
const typeorm_1 = require("typeorm");
const config_1 = require("../config");
let AiRun = class AiRun {
    id;
    model;
    status;
    latencyMs;
    promptTokens;
    completionTokens;
    snapshot;
    errorMessage;
    reasoningTrace;
    createdAt;
};
exports.AiRun = AiRun;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], AiRun.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 120 }),
    __metadata("design:type", String)
], AiRun.prototype, "model", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, default: 'success' }),
    __metadata("design:type", String)
], AiRun.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'latency_ms', type: 'integer', nullable: true }),
    __metadata("design:type", Object)
], AiRun.prototype, "latencyMs", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'prompt_tokens', type: 'integer', nullable: true }),
    __metadata("design:type", Object)
], AiRun.prototype, "promptTokens", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'completion_tokens', type: 'integer', nullable: true }),
    __metadata("design:type", Object)
], AiRun.prototype, "completionTokens", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snapshot', type: 'jsonb', default: () => "'{}'::jsonb" }),
    __metadata("design:type", Object)
], AiRun.prototype, "snapshot", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'error_message', type: 'text', nullable: true }),
    __metadata("design:type", Object)
], AiRun.prototype, "errorMessage", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reasoning_trace', type: 'text', nullable: true }),
    __metadata("design:type", Object)
], AiRun.prototype, "reasoningTrace", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], AiRun.prototype, "createdAt", void 0);
exports.AiRun = AiRun = __decorate([
    (0, typeorm_1.Entity)({ schema: config_1.config.db.schema, name: 'ai_runs' })
], AiRun);
