import { SERVICE_SCOPES, getScopesForService, hasScope } from '../auth/serviceScopes';

describe('ServiceScopes', () => {
  describe('SERVICE_SCOPES', () => {
    it('should define scopes for borrow-service', () => {
      expect(SERVICE_SCOPES['borrow-service']).toBeDefined();
      expect(SERVICE_SCOPES['borrow-service']).toContain('users:read');
      expect(SERVICE_SCOPES['borrow-service']).toContain('access:read');
      expect(SERVICE_SCOPES['borrow-service']).toContain('access:write');
      expect(SERVICE_SCOPES['borrow-service']).toContain('notifications:send');
    });

    it('should define scopes for user-service', () => {
      expect(SERVICE_SCOPES['user-service']).toBeDefined();
      expect(SERVICE_SCOPES['user-service']).toContain('access:read');
      expect(SERVICE_SCOPES['user-service']).toContain('access:write');
      expect(SERVICE_SCOPES['user-service']).toContain('notifications:send');
      expect(SERVICE_SCOPES['user-service']).toContain('faces:read');
      expect(SERVICE_SCOPES['user-service']).toContain('faces:write');
      expect(SERVICE_SCOPES['user-service']).toContain('borrows:read');
    });

    it('should define scopes for access-service', () => {
      expect(SERVICE_SCOPES['access-service']).toBeDefined();
      expect(SERVICE_SCOPES['access-service']).toContain('users:read');
    });

    it('should define scopes for schedule-service', () => {
      expect(SERVICE_SCOPES['schedule-service']).toBeDefined();
      expect(SERVICE_SCOPES['schedule-service']).toContain('users:read');
    });

    it('should define scopes for automation-service', () => {
      expect(SERVICE_SCOPES['automation-service']).toBeDefined();
      expect(SERVICE_SCOPES['automation-service']).toContain('users:read');
      expect(SERVICE_SCOPES['automation-service']).toContain('borrows:read');
      expect(SERVICE_SCOPES['automation-service']).toContain('schedules:read');
      expect(SERVICE_SCOPES['automation-service']).toContain('access:read');
      expect(SERVICE_SCOPES['automation-service']).toContain('access:write');
      expect(SERVICE_SCOPES['automation-service']).toContain('notifications:send');
    });

    it('should define scopes for ai-service', () => {
      expect(SERVICE_SCOPES['ai-service']).toBeDefined();
      expect(SERVICE_SCOPES['ai-service']).toContain('borrows:read');
      expect(SERVICE_SCOPES['ai-service']).toContain('borrows:write');
      expect(SERVICE_SCOPES['ai-service']).toContain('users:read');
      expect(SERVICE_SCOPES['ai-service']).toContain('schedules:read');
      expect(SERVICE_SCOPES['ai-service']).toContain('access:read');
    });

    it('should return empty array for unknown service', () => {
      expect(SERVICE_SCOPES['unknown-service']).toBeUndefined();
      expect(getScopesForService('unknown-service')).toEqual([]);
    });
  });

  describe('getScopesForService', () => {
    it('should return scopes for known service', () => {
      const scopes = getScopesForService('borrow-service');
      expect(scopes).toContain('users:read');
    });

    it('should return empty array for unknown service', () => {
      const scopes = getScopesForService('nonexistent');
      expect(scopes).toEqual([]);
    });
  });

  describe('hasScope', () => {
    it('should return true when service has required scope', () => {
      expect(hasScope('borrow-service', 'users:read')).toBe(true);
    });

    it('should return false when service lacks required scope', () => {
      expect(hasScope('access-service', 'borrows:write')).toBe(false);
    });

    it('should return false for unknown service', () => {
      expect(hasScope('unknown-service', 'users:read')).toBe(false);
    });
  });
});
