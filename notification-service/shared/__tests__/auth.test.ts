import * as jwt from 'jsonwebtoken';
import { decodeToken } from '../auth/decodeToken';
import { createAuth } from '../auth/auth';
import { createInternalAuth } from '../auth/internalAuth';
import { AuthConfig, InternalAuthConfig, AuthRequest } from '../auth/types';
import { generateServiceToken } from '../auth/serviceToken';

const TEST_SECRET = 'test-secret';
const TEST_CONFIG: AuthConfig = {
  jwtSecret: TEST_SECRET,
  jwtAudience: 'test-audience',
  jwtIssuer: 'test-issuer',
};

describe('decodeToken', () => {
  it('should decode a valid token', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      roles: ['admin'],
      full_name: 'Test User',
    };
    const token = jwt.sign(payload, TEST_SECRET, {
      audience: 'test-audience',
      issuer: 'test-issuer',
    });

    const result = decodeToken(token, TEST_CONFIG);

    expect(result.userId).toBe('user-123');
    expect(result.email).toBe('test@example.com');
    expect(result.role).toBe('admin');
    expect(result.fullName).toBe('Test User');
  });

  it('should throw for invalid token', () => {
    expect(() => {
      decodeToken('invalid-token', TEST_CONFIG);
    }).toThrow();
  });
});

describe('createInternalAuth', () => {
  const config: InternalAuthConfig = {
    serviceName: 'test-service',
    jwtSecret: TEST_SECRET,
  };

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
    const token = generateServiceToken('test-service', ['user:read'], TEST_SECRET);
    const middleware = createInternalAuth(config);
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.service).toBeDefined();
  });

  it('should return 403 for invalid token', () => {
    const middleware = createInternalAuth(config);
    const req = mockReq('Bearer invalid-token');
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid service token',
    });
  });

  it('should return 403 for missing Authorization header', () => {
    const middleware = createInternalAuth(config);
    const req = mockReq();
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Missing Authorization header',
    });
  });

  it('should return 403 for non-Bearer Authorization header', () => {
    const middleware = createInternalAuth(config);
    const req = mockReq('Basic some-token');
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('createAuth (cookie fallback)', () => {
  const mockReq = (opts: { authHeader?: string; cookies?: Record<string, string> } = {}) => ({
    headers: opts.authHeader ? { authorization: opts.authHeader } : {},
    cookies: opts.cookies || {},
  } as any as AuthRequest);

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

  const middleware = createAuth(TEST_CONFIG);

  it('should accept Bearer header token', () => {
    const token = jwt.sign({ sub: 'user-1', roles: ['admin'] }, TEST_SECRET, {
      audience: 'test-audience',
      issuer: 'test-issuer',
    });
    const req = mockReq({ authHeader: `Bearer ${token}` });
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.token).toBe(token);
  });

  it('should fall back to cookie when no Bearer header', () => {
    const token = jwt.sign({ sub: 'user-2', roles: ['staff'] }, TEST_SECRET, {
      audience: 'test-audience',
      issuer: 'test-issuer',
    });
    const req = mockReq({ cookies: { access_token: token } });
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.token).toBe(token);
  });

  it('should return 401 when neither header nor cookie has token', () => {
    const req = mockReq({});
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should prefer Bearer header over cookie', () => {
    const headerToken = jwt.sign({ sub: 'from-header' }, TEST_SECRET, {
      audience: 'test-audience',
      issuer: 'test-issuer',
    });
    const cookieToken = jwt.sign({ sub: 'from-cookie' }, TEST_SECRET, {
      audience: 'test-audience',
      issuer: 'test-issuer',
    });
    const req = mockReq({ authHeader: `Bearer ${headerToken}`, cookies: { access_token: cookieToken } });
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(req.user!.token).toBe(headerToken);
  });
});
