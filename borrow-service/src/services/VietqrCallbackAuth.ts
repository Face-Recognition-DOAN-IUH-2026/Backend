import jwt from 'jsonwebtoken';

const TOKEN_TTL_SECONDS = 300;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[VietQR] ${name} must be set`);
  }
  return value;
}

/**
 * Partner-side token issuer for VietQR callbacks.
 * VietQR calls OUR token-generate endpoint with Basic auth (credentials we
 * define and share with the VietQR team), receives a short-lived HS512 JWT,
 * then presents it as Bearer on every transaction-sync callback.
 */
export function issuePartnerToken(username: string): string {
  const secret = requiredEnv('VIETQR_CALLBACK_SECRET');
  return jwt.sign({ sub: 'vietqr-callback', username }, secret, {
    algorithm: 'HS512',
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

export function verifyPartnerToken(token: string): { username: string } {
  const secret = requiredEnv('VIETQR_CALLBACK_SECRET');
  const decoded = jwt.verify(token, secret, { algorithms: ['HS512'] }) as any;
  if (!decoded || decoded.sub !== 'vietqr-callback') {
    throw new Error('Invalid token subject');
  }
  return { username: decoded.username };
}

export function checkPartnerBasicAuth(header: string | undefined): string {
  if (!header || !header.startsWith('Basic ')) {
    throw new Error('INVALID_AUTH_HEADER');
  }
  const credentials = Buffer.from(header.slice('Basic '.length).trim(), 'base64').toString('utf-8');
  const sep = credentials.indexOf(':');
  if (sep < 0) {
    throw new Error('INVALID_AUTH_HEADER');
  }
  const username = credentials.slice(0, sep);
  const password = credentials.slice(sep + 1);
  const expectedUser = requiredEnv('VIETQR_CALLBACK_USERNAME');
  const expectedPass = requiredEnv('VIETQR_CALLBACK_PASSWORD');
  if (username !== expectedUser || password !== expectedPass) {
    throw new Error('INVALID_CREDENTIALS');
  }
  return username;
}

export const VIETQR_TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS;
