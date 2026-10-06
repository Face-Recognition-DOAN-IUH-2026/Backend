import { Request, Response } from 'express';
import { setAuthCookie, clearAuthCookie } from '../auth/cookie-helper';

function mockRes(): Response {
  const cookies: Record<string, any> = {};
  const res = {
    req: { secure: false, headers: {} },
    cookie: jest.fn((name: string, value: string, opts: any) => { cookies[name] = { value, opts }; }),
    clearCookie: jest.fn((name: string, opts: any) => { delete cookies[name]; }),
  } as unknown as Response;
  return res;
}

describe('setAuthCookie', () => {
  it('sets httpOnly sameSite=strict cookie with maxAge', () => {
    const res = mockRes();
    setAuthCookie(res, 'test-token');
    expect(res.cookie).toHaveBeenCalledWith('access_token', 'test-token', {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/',
      maxAge: 86400 * 1000,
    });
  });

  it('sets secure flag when request is over https', () => {
    const res = mockRes() as any;
    res.req.secure = true;
    setAuthCookie(res, 'test-token');
    expect(res.cookie).toHaveBeenCalledWith('access_token', 'test-token', expect.objectContaining({ secure: true }));
  });

  it('sets secure flag when x-forwarded-proto is https', () => {
    const res = mockRes() as any;
    res.req.headers['x-forwarded-proto'] = 'https';
    setAuthCookie(res, 'test-token');
    expect(res.cookie).toHaveBeenCalledWith('access_token', 'test-token', expect.objectContaining({ secure: true }));
  });
});

describe('clearAuthCookie', () => {
  it('clears the access_token cookie', () => {
    const res = mockRes();
    clearAuthCookie(res);
    expect(res.clearCookie).toHaveBeenCalledWith('access_token', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
  });
});
