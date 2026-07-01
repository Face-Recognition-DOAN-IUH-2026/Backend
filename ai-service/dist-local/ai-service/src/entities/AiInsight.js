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
exports.AiInsight = void 0;
const typeorm_1 = require("typeorm");
const config_1 = require("../config");
let AiInsight = class AiInsight {
    id;
    category;
    severity;
    title;
    summary;
    evidence;
    recommendedActions;
    reason;
    confidence;
    alternatives;
    status;
    runId;
    generatedAt;
};
exports.AiInsight = AiInsight;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], AiInsight.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 30 }),
    __metadata("design:type", String)
], AiInsight.prototype, "category", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20 }),
    __metadata("design:type", String)
], AiInsight.prototype, "severity", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], AiInsight.prototype, "title", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text' }),
    __metadata("design:type", String)
], AiInsight.prototype, "summary", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', default: () => "'[]'::jsonb" }),
    __metadata("design:type", Array)
], AiInsight.prototype, "evidence", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'recommended_actions', type: 'jsonb', default: () => "'[]'::jsonb" }),
    __metadata("design:type", Array)
], AiInsight.prototype, "recommendedActions", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], AiInsight.prototype, "reason", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'float', default: 0.85 }),
    __metadata("design:type", Number)
], AiInsight.prototype, "confidence", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', default: () => "'[]'::jsonb" }),
    __metadata("design:type", Array)
], AiInsight.prototype, "alternatives", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, default: 'open' }),
    __metadata("design:type", String)
], AiInsight.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'run_id', type: 'uuid', nullable: true }),
    __metadata("design:type", Object)
], AiInsight.prototype, "runId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'generated_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], AiInsight.prototype, "generatedAt", void 0);
exports.AiInsight = AiInsight = __decorate([
    (0, typeorm_1.Entity)({ schema: config_1.config.db.schema, name: 'ai_insights' })
], AiInsight);
