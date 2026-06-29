import {
  generateServiceToken,
  verifyServiceToken,
  createServiceAuthMiddleware,
} from '../auth/serviceToken';
import { ServiceToken } from '../auth/types';

const TEST_SECRET = 'test-service-jwt-secret-key-minimum-32-chars';

describe('ServiceToken utilities', () => {
  describe('generateServiceToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateServiceToken('borrow-service', ['users:read'], TEST_SECRET);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include service name in sub claim', () => {
      const token = generateServiceToken('borrow-service', ['users:read'], TEST_SECRET);
      const payload = verifyServiceToken(token, TEST_SECRET);
      expect(payload.sub).toBe('borrow-service');
    });

    it('should include scopes in scope claim', () => {
      const scopes = ['users:read', 'access:write', 'notifications:send'];
      const token = generateServiceToken('user-service', scopes, TEST_SECRET);
      const payload = verifyServiceToken(token, TEST_SECRET);
      expect(payload.scope).toEqual(scopes);
    });

    it('should set iat and exp timestamps', () => {
      const before = Math.floor(Date.now() / 1000);
      const token = generateServiceToken('test', ['read'], TEST_SECRET, 900);
      const after = Math.floor(Date.now() / 1000);
      const payload = verifyServiceToken(token, TEST_SECRET);
      expect(payload.iat).toBeGreaterThanOrEqual(before);
      expect(payload.iat).toBeLessThanOrEqual(after);
      expect(payload.exp).toBe(payload.iat + 900);
    });

    it('should use custom expiration', () => {
      const token = generateServiceToken('test', ['read'], TEST_SECRET, 3600);
      const payload = verifyServiceToken(token, TEST_SECRET);
      expect(payload.exp - payload.iat).toBe(3600);
    });

    it('should default to 900 seconds expiration', () => {
      const token = generateServiceToken('test', ['read'], TEST_SECRET);
      const payload = verifyServiceToken(token, TEST_SECRET);
      expect(payload.exp - payload.iat).toBe(900);
    });
  });

  describe('verifyServiceToken', () => {
    it('should verify a valid token', () => {
      const token = generateServiceToken('test', ['read'], TEST_SECRET);
      const payload = verifyServiceToken(token, TEST_SECRET);
      expect(payload.sub).toBe('test');
    });

    it('should throw for invalid token', () => {
      expect(() => {
        verifyServiceToken('invalid.token.here', TEST_SECRET);
      }).toThrow();
    });

    it('should throw for expired token', () => {
      const token = generateServiceToken('test', ['read'], TEST_SECRET, -1); // expired
      expect(() => {
        verifyServiceToken(token, TEST_SECRET);
      }).toThrow();
    });

    it('should throw for wrong secret', () => {
      const token = generateServiceToken('test', ['read'], TEST_SECRET);
      expect(() => {
        verifyServiceToken(token, 'wrong-secret');
      }).toThrow();
    });

    it('should return full ServiceToken payload', () => {
      const token = generateServiceToken('my-service', ['scope1', 'scope2'], TEST_SECRET);
      const payload: ServiceToken = verifyServiceToken(token, TEST_SECRET);
      expect(payload).toHaveProperty('sub');
      expect(payload).toHaveProperty('scope');
      expect(payload).toHaveProperty('iat');
      expect(payload).toHaveProperty('exp');
    });
  });

  describe('createServiceAuthMiddleware', () => {
    const mockReq = (authHeader?: string) => ({
      headers: authHeader ? { authorization: authHeader } : {},
      path: '/test',
    } as any);

    const mockRes = () => {
      const res: any = {};
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      return res;
    };

    const mockNext = jest.fn();

    beforeEach(() => {
      mockNext.mockClear();
    });

    it('should call next for valid service token', () => {
      const token = generateServiceToken('borrow-service', ['users:read'], TEST_SECRET);
      const middleware = createServiceAuthMiddleware({
        serviceName: 'user-service',
        jwtSecret: TEST_SECRET,
        requiredScopes: ['users:read'],
      });
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 401 for missing Authorization header', () => {
      const middleware = createServiceAuthMiddleware({
        serviceName: 'user-service',
        jwtSecret: TEST_SECRET,
        requiredScopes: ['users:read'],
      });
      const req = mockReq();
      const res = mockRes();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 for expired token', () => {
      const token = generateServiceToken('borrow-service', ['users:read'], TEST_SECRET, -1);
      const middleware = createServiceAuthMiddleware({
        serviceName: 'user-service',
        jwtSecret: TEST_SECRET,
        requiredScopes: ['users:read'],
      });
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 403 when required scope is missing', () => {
      const token = generateServiceToken('borrow-service', ['users:read'], TEST_SECRET);
      const middleware = createServiceAuthMiddleware({
        serviceName: 'user-service',
        jwtSecret: TEST_SECRET,
        requiredScopes: ['borrows:write'], // not in token
      });
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 403 when only one of multiple required scopes is present', () => {
      const token = generateServiceToken('borrow-service', ['users:read'], TEST_SECRET);
      const middleware = createServiceAuthMiddleware({
        serviceName: 'user-service',
        jwtSecret: TEST_SECRET,
        requiredScopes: ['users:read', 'borrows:write'], // borrows:write missing
      });
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should attach service info to request', () => {
      const token = generateServiceToken('borrow-service', ['users:read'], TEST_SECRET);
      const middleware = createServiceAuthMiddleware({
        serviceName: 'user-service',
        jwtSecret: TEST_SECRET,
        requiredScopes: ['users:read'],
      });
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();

      middleware(req, res, mockNext);

      expect(req.service).toBeDefined();
      expect(req.service!.sub).toBe('borrow-service');
      expect(req.service!.scope).toContain('users:read');
    });
  });
});
