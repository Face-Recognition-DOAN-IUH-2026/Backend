jest.mock('./src/config', () => ({
  config: {
    borrowServiceUrl: 'http://borrow-service:8000',
    userServiceUrl: 'http://user-service:3001',
    scheduleServiceUrl: 'http://schedule-service:3004',
    serviceJwtSecret: 'test-service-jwt-secret',
    jwtSecret: 'test-jwt-secret',
    jwtAudience: 'test-audience',
    jwtIssuer: 'test-issuer',
  },
}));

jest.mock('axios');
