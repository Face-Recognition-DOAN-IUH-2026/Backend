/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from 'fs';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { requireRole } from '../../../shared/auth/requireRole';
import { AuthRequest } from '../../../shared/auth/types';

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockNext(): NextFunction {
  return jest.fn();
}

function mockAuthReq(role?: string): AuthRequest {
  return {
    user: role ? { userId: 'u1', id: 'u1', email: 'test@test.com', role, fullName: 'Test' } : undefined,
    headers: {},
  } as AuthRequest;
}

const routeFilePath = path.resolve(__dirname, '../routes/schedule.routes.ts');

function getRouteFileContent(): string {
  return fs.readFileSync(routeFilePath, 'utf-8');
}

describe('SCHED-AVAIL-403 — Availability Route Authorization', () => {
  describe('Route file guard configuration', () => {
    it('GET /availability should use requireRole("admin", "staff") not requireRole("admin")', () => {
      const content = getRouteFileContent();
      const availabilityLine = content.split('\n').find((line, idx) => {
        const lines = content.split('\n');
        const prevLine = lines[idx - 1];
        return line.includes("router.get('/availability'") && prevLine?.includes('swagger') === false;
      });

      expect(availabilityLine).toBeDefined();
      expect(availabilityLine).toContain("requireRole('admin', 'staff')");
      expect(availabilityLine).not.toContain("requireRole('admin')");
    });

    it('POST /availability/:id/approve should use requireRole("admin") only', () => {
      const content = getRouteFileContent();
      const approveLine = content.split('\n').find((line) =>
        line.includes("router.post('/availability/:id/approve'")
      );
      expect(approveLine).toBeDefined();
      expect(approveLine).toContain("requireRole('admin')");
    });

    it('POST /availability/:id/reject should use requireRole("admin") only', () => {
      const content = getRouteFileContent();
      const rejectLine = content.split('\n').find((line) =>
        line.includes("router.post('/availability/:id/reject'")
      );
      expect(rejectLine).toBeDefined();
      expect(rejectLine).toContain("requireRole('admin')");
    });
  });

  describe('requireRole("admin", "staff") middleware behavior', () => {
    const guard = requireRole('admin', 'staff');

    it('should allow admin role', () => {
      const req = mockAuthReq('admin');
      const res = mockRes();
      const next = mockNext();
      guard(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow staff role', () => {
      const req = mockAuthReq('staff');
      const res = mockRes();
      const next = mockNext();
      guard(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should deny patron role with 403', () => {
      const req = mockAuthReq('patron');
      const res = mockRes();
      const next = mockNext();
      guard(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should deny user with no role with 403', () => {
      const req = mockAuthReq('');
      const res = mockRes();
      const next = mockNext();
      guard(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should deny request with no user object with 403', () => {
      const req = mockAuthReq(undefined);
      const res = mockRes();
      const next = mockNext();
      guard(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireRole("admin") middleware behavior (approve/reject guards)', () => {
    const guard = requireRole('admin');

    it('should allow admin role', () => {
      const req = mockAuthReq('admin');
      const res = mockRes();
      const next = mockNext();
      guard(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should deny staff role with 403', () => {
      const req = mockAuthReq('staff');
      const res = mockRes();
      const next = mockNext();
      guard(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should deny patron role with 403', () => {
      const req = mockAuthReq('patron');
      const res = mockRes();
      const next = mockNext();
      guard(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
