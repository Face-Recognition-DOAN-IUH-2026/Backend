import { Response } from 'express';

const ACCESS_TOKEN_MAX_AGE = 15 * 60; // 15 minutes
const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export function setAuthCookie(res: Response, accessToken: string, refreshToken?: string): void {
  const isSecure = res.req?.secure || res.req?.headers?.['x-forwarded-proto'] === 'https';
  
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TOKEN_MAX_AGE * 1000,
  });

  if (refreshToken) {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: REFRESH_TOKEN_MAX_AGE * 1000,
    });
  }
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie('access_token', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie('refresh_token', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
}
