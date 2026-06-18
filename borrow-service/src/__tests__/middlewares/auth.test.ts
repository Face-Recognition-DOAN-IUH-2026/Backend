import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { auth, AuthRequest, requireRole } from '../../middlewares/auth';
import { HttpError } from '../../middlewares/errorHandler';

jest.mock('../../config', () => ({
  config: {
    jwtSecret: 'test-secret-key-for-jwt-signing-minimum-32-chars',
    jwtIssuer: 'face-recognition',
    jwtAudience: 'face-recognition-users',
  },
}));

describe('Auth Middleware', () => {
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('auth middleware', () => {
    it('should return 401 when no authorization header', () => {
      auth(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ detail: 'Invalid or expired token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header does not start with Bearer', () => {
      mockReq.headers = { authorization: 'Basic sometoken' };

      auth(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ detail: 'Invalid or expired token' });
    });

    it('should return 401 for invalid token', () => {
      mockReq.headers = { authorization: 'Bearer invalid-token' };

      auth(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ detail: 'Invalid or expired token' });
    });

    it('should call next and set user for valid token', () => {
      const payload = {
        sub: '11111111-1111-1111-1111-111111111111',
        email: 'test@example.com',
        roles: ['patron'],
        aud: 'face-recognition-users',
        iss: 'face-recognition',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = jwt.sign(payload, 'test-secret-key-for-jwt-signing-minimum-32-chars');
      mockReq.headers = { authorization: `Bearer ${token}` };

      auth(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user!.id).toBe('11111111-1111-1111-1111-111111111111');
      expect(mockReq.user!.email).toBe('test@example.com');
      expect(mockReq.user!.role).toBe('patron');
    });

    it('should handle token with role instead of roles array', () => {
      const payload = {
        sub: 'user-id-123',
        email: 'user@example.com',
        role: 'staff',
        aud: 'face-recognition-users',
        iss: 'face-recognition',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = jwt.sign(payload, 'test-secret-key-for-jwt-signing-minimum-32-chars');
      mockReq.headers = { authorization: `Bearer ${token}` };

      auth(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user!.role).toBe('staff');
    });
  });

  describe('requireRole', () => {
    it('should return 403 when user role is not in allowed roles', () => {
      const middleware = requireRole(['admin', 'staff'], 'Forbidden');
      mockReq.user = { id: 'user-id', email: 'user@test.com', role: 'patron' };

      middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ detail: 'Forbidden' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next when user role is in allowed roles', () => {
      const middleware = requireRole(['admin', 'staff'], 'Forbidden');
      mockReq.user = { id: 'user-id', email: 'staff@test.com', role: 'staff' };

      middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should call next when user is admin and admin is in allowed roles', () => {
      const middleware = requireRole(['admin', 'staff'], 'Forbidden');
      mockReq.user = { id: 'admin-id', email: 'admin@test.com', role: 'admin' };

      middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle multiple allowed roles', () => {
      const middleware = requireRole(['patron', 'staff', 'admin'], 'Forbidden');
      mockReq.user = { id: 'patron-id', email: 'patron@test.com', role: 'patron' };

      middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 403 when user is undefined', () => {
      const middleware = requireRole(['admin', 'staff'], 'Forbidden');

      middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ detail: 'Forbidden' });
    });
  });
});