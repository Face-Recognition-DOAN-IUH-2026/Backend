"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const serviceScopes_1 = require("../auth/serviceScopes");
describe('ServiceScopes', () => {
    describe('SERVICE_SCOPES', () => {
        it('should define scopes for borrow-service', () => {
            expect(serviceScopes_1.SERVICE_SCOPES['borrow-service']).toBeDefined();
            expect(serviceScopes_1.SERVICE_SCOPES['borrow-service']).toContain('users:read');
            expect(serviceScopes_1.SERVICE_SCOPES['borrow-service']).toContain('access:read');
            expect(serviceScopes_1.SERVICE_SCOPES['borrow-service']).toContain('access:write');
            expect(serviceScopes_1.SERVICE_SCOPES['borrow-service']).toContain('notifications:send');
        });
        it('should define scopes for user-service', () => {
            expect(serviceScopes_1.SERVICE_SCOPES['user-service']).toBeDefined();
            expect(serviceScopes_1.SERVICE_SCOPES['user-service']).toContain('access:read');
            expect(serviceScopes_1.SERVICE_SCOPES['user-service']).toContain('access:write');
            expect(serviceScopes_1.SERVICE_SCOPES['user-service']).toContain('notifications:send');
            expect(serviceScopes_1.SERVICE_SCOPES['user-service']).toContain('faces:read');
            expect(serviceScopes_1.SERVICE_SCOPES['user-service']).toContain('faces:write');
            expect(serviceScopes_1.SERVICE_SCOPES['user-service']).toContain('borrows:read');
        });
        it('should define scopes for access-service', () => {
            expect(serviceScopes_1.SERVICE_SCOPES['access-service']).toBeDefined();
            expect(serviceScopes_1.SERVICE_SCOPES['access-service']).toContain('users:read');
        });
        it('should define scopes for schedule-service', () => {
            expect(serviceScopes_1.SERVICE_SCOPES['schedule-service']).toBeDefined();
            expect(serviceScopes_1.SERVICE_SCOPES['schedule-service']).toContain('users:read');
        });
        it('should define scopes for automation-service', () => {
            expect(serviceScopes_1.SERVICE_SCOPES['automation-service']).toBeDefined();
            expect(serviceScopes_1.SERVICE_SCOPES['automation-service']).toContain('users:read');
            expect(serviceScopes_1.SERVICE_SCOPES['automation-service']).toContain('borrows:read');
            expect(serviceScopes_1.SERVICE_SCOPES['automation-service']).toContain('schedules:read');
            expect(serviceScopes_1.SERVICE_SCOPES['automation-service']).toContain('access:read');
            expect(serviceScopes_1.SERVICE_SCOPES['automation-service']).toContain('access:write');
            expect(serviceScopes_1.SERVICE_SCOPES['automation-service']).toContain('notifications:send');
        });
        it('should define scopes for ai-service', () => {
            expect(serviceScopes_1.SERVICE_SCOPES['ai-service']).toBeDefined();
            expect(serviceScopes_1.SERVICE_SCOPES['ai-service']).toContain('borrows:read');
            expect(serviceScopes_1.SERVICE_SCOPES['ai-service']).toContain('borrows:write');
            expect(serviceScopes_1.SERVICE_SCOPES['ai-service']).toContain('users:read');
            expect(serviceScopes_1.SERVICE_SCOPES['ai-service']).toContain('schedules:read');
            expect(serviceScopes_1.SERVICE_SCOPES['ai-service']).toContain('access:read');
        });
        it('should return empty array for unknown service', () => {
            expect(serviceScopes_1.SERVICE_SCOPES['unknown-service']).toBeUndefined();
            expect((0, serviceScopes_1.getScopesForService)('unknown-service')).toEqual([]);
        });
    });
    describe('getScopesForService', () => {
        it('should return scopes for known service', () => {
            const scopes = (0, serviceScopes_1.getScopesForService)('borrow-service');
            expect(scopes).toContain('users:read');
        });
        it('should return empty array for unknown service', () => {
            const scopes = (0, serviceScopes_1.getScopesForService)('nonexistent');
            expect(scopes).toEqual([]);
        });
    });
    describe('hasScope', () => {
        it('should return true when service has required scope', () => {
            expect((0, serviceScopes_1.hasScope)('borrow-service', 'users:read')).toBe(true);
        });
        it('should return false when service lacks required scope', () => {
            expect((0, serviceScopes_1.hasScope)('access-service', 'borrows:write')).toBe(false);
        });
        it('should return false for unknown service', () => {
            expect((0, serviceScopes_1.hasScope)('unknown-service', 'users:read')).toBe(false);
        });
    });
});
