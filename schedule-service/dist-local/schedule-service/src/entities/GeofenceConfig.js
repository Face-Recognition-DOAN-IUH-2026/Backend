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
exports.GeofenceConfig = void 0;
const typeorm_1 = require("typeorm");
let GeofenceConfig = class GeofenceConfig {
};
exports.GeofenceConfig = GeofenceConfig;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], GeofenceConfig.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'zone_id', unique: true }),
    __metadata("design:type", String)
], GeofenceConfig.prototype, "zoneId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'double precision' }),
    __metadata("design:type", Number)
], GeofenceConfig.prototype, "latitude", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'double precision' }),
    __metadata("design:type", Number)
], GeofenceConfig.prototype, "longitude", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', name: 'radius_meters', default: 100 }),
    __metadata("design:type", Number)
], GeofenceConfig.prototype, "radiusMeters", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: true, name: 'is_active' }),
    __metadata("design:type", Boolean)
], GeofenceConfig.prototype, "isActive", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true, name: 'address_hint' }),
    __metadata("design:type", Object)
], GeofenceConfig.prototype, "addressHint", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', array: true, nullable: true, name: 'allowed_wifi_ssids' }),
    __metadata("design:type", Object)
], GeofenceConfig.prototype, "allowedWifiSsids", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], GeofenceConfig.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], GeofenceConfig.prototype, "updatedAt", void 0);
exports.GeofenceConfig = GeofenceConfig = __decorate([
    (0, typeorm_1.Entity)({ name: 'geofence_configs', schema: 'schedule' })
], GeofenceConfig);
