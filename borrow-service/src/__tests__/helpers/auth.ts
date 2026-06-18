import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const PATRON_UUID = '11111111-1111-1111-1111-111111111111';
export const STAFF_UUID = '22222222-2222-2222-2222-222222222222';
export const ADMIN_UUID = '33333333-3333-3333-3333-333333333333';

export function createToken(
  uuid: string,
  email: string,
  roles: string[],
  expired = false
): string {
  const exp = expired
    ? Math.floor(Date.now() / 1000) - 3600
    : Math.floor(Date.now() / 1000) + 3600;

  const payload = {
    sub: uuid,
    email,
    roles,
    aud: 'face-recognition-users',
    iss: 'face-recognition',
    exp,
    iat: Math.floor(Date.now() / 1000),
    typ: 'access',
  };

  return jwt.sign(payload, 'test-secret-key-for-jwt-signing-minimum-32-chars', {
    algorithm: 'HS256',
  });
}

export function patronToken(expired = false): string {
  return createToken(PATRON_UUID, 'patron@example.com', ['patron'], expired);
}

export function staffToken(expired = false): string {
  return createToken(STAFF_UUID, 'staff@example.com', ['staff'], expired);
}

export function adminToken(expired = false): string {
  return createToken(ADMIN_UUID, 'admin@example.com', ['admin'], expired);
}

export function expiredToken(): string {
  return patronToken(true);
}

export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function patronAuthHeader(): Record<string, string> {
  return authHeader(patronToken());
}

export function staffAuthHeader(): Record<string, string> {
  return authHeader(staffToken());
}

export function adminAuthHeader(): Record<string, string> {
  return authHeader(adminToken());
}

export function mockRequest(
  overrides: Partial<Request> & { user?: { id: string; email: string; role: string } }
): Partial<Request> {
  return {
    headers: {},
    query: {},
    params: {},
    body: {},
    user: undefined,
    ...overrides,
  } as Partial<Request>;
}

export function mockResponse(): { res: Partial<Response>; jsonMock: jest.Mock; statusMock: jest.Mock } {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  const res = {
    json: jsonMock,
    status: statusMock,
    setHeader: jest.fn(),
    getHeader: jest.fn(),
    end: jest.fn(),
  };
  return { res, jsonMock, statusMock };
}

export function mockNext(): jest.Mock {
  return jest.fn();
}

export function createMockUser(id: string, email: string, role: string) {
  return { id, email, role };
}

export function createMockPatronUser() {
  return createMockUser(PATRON_UUID, 'patron@example.com', 'patron');
}

export function createMockStaffUser() {
  return createMockUser(STAFF_UUID, 'staff@example.com', 'staff');
}

export function createMockAdminUser() {
  return createMockUser(ADMIN_UUID, 'admin@example.com', 'admin');
}