export function requireServiceSecret(secret: string | undefined, nodeEnv: string): string {
  if (nodeEnv === 'production' && (!secret || secret.length < 16)) {
    throw new Error('[Config] SERVICE_JWT_SECRET must be set and at least 16 characters in production');
  }
  return secret || '';
}
