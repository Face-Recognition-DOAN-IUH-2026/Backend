import { Response } from 'express';

const ACCESS_TOKEN_MAX_AGE = 86400;

export function setAuthCookie(res: Response, accessToken: string): void {
  const isSecure = res.req.secure || res.req.headers['x-forwarded-proto'] === 'https';
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: ACCESS_TOKEN_MAX_AGE * 1000,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie('access_token', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  });
}
