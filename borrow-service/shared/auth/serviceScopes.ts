export const SERVICE_SCOPES: Record<string, string[]> = {
  'borrow-service': [
    'users:read',
    'access:read',
    'access:write',
    'notifications:send',
  ],
  'user-service': [
    'access:read',
    'access:write',
    'notifications:send',
    'faces:read',
    'faces:write',
    'borrows:read',
  ],
  'access-service': [
    'users:read',
  ],
  'schedule-service': [
    'users:read',
    'users:read:staff',
  ],
  'automation-service': [
    'users:read',
    'borrows:read',
    'schedules:read',
    'access:read',
    'access:write',
    'notifications:send',
  ],
  'ai-service': [
    'borrows:read',
    'users:read',
    'schedules:read',
    'access:read',
  ],
  'face-recognition-service': [
    'users:read',
    'users:write',
    'access:read',
    'access:write',
  ],
};

export function getScopesForService(serviceName: string): string[] {
  return SERVICE_SCOPES[serviceName] || [];
}

export function hasScope(serviceName: string, scope: string): boolean {
  const scopes = getScopesForService(serviceName);
  return scopes.includes(scope);
}
