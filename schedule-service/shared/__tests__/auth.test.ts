import * as jwt from 'jsonwebtoken';
import { decodeToken } from '../auth/decodeToken';
import { createInternalAuth } from '../auth/internalAuth';
import { AuthConfig, InternalAuthConfig } from '../auth/types';

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
    internalApiKey: 'test-api-key',
  };

  const mockReq = (apiKey?: string) => ({
    headers: apiKey ? { 'x-internal-api-key': apiKey } : {},
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

  it('should call next for valid API key', () => {
    const middleware = createInternalAuth(config);
    const req = mockReq('test-api-key');
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 403 for invalid API key', () => {
    const middleware = createInternalAuth(config);
    const req = mockReq('wrong-key');
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid or missing internal API key',
    });
  });

  it('should return 403 for missing API key', () => {
    const middleware = createInternalAuth(config);
    const req = mockReq();
    const res = mockRes();

    middleware(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
