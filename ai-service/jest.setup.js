jest.mock('../src/config', () => ({
  config: {
    borrowServiceUrl: 'http://borrow-service:8000',
    userServiceUrl: 'http://user-service:3001',
    scheduleServiceUrl: 'http://schedule-service:3004',
    internalApiKey: 'test-api-key',
  },
}));

jest.mock('axios');
