require('reflect-metadata');

jest.mock('./src/clients/serviceClients', () => ({
  borrowClient: {
    getOverdueBorrows: jest.fn().mockResolvedValue([]),
    getDueSoonBorrows: jest.fn().mockResolvedValue([]),
    getActiveBorrowers: jest.fn().mockResolvedValue([]),
    getBooks: jest.fn().mockResolvedValue([]),
  },
  notificationClient: {
    createNotification: jest.fn().mockResolvedValue({ id: 'mock-notif-id' }),
    createBulkNotifications: jest.fn().mockResolvedValue([]),
  },
  userClient: {
    getUser: jest.fn().mockResolvedValue(null),
    getUsers: jest.fn().mockResolvedValue({}),
    getUsersByRole: jest.fn().mockResolvedValue([]),
    getExpiringMemberships: jest.fn().mockResolvedValue([]),
  },
  emailClient: {
    sendOverdueEmail: jest.fn().mockResolvedValue({ success: true }),
    sendFineEmail: jest.fn().mockResolvedValue({ success: true }),
    sendMembershipExpiryEmail: jest.fn().mockResolvedValue({ success: true }),
  },
  scheduleClient: {
    getTodayAssignments: jest.fn().mockResolvedValue([]),
    getAttendance: jest.fn().mockResolvedValue([]),
  },
  accessClient: {
    getStats: jest.fn().mockResolvedValue({}),
    getActivePatrons: jest.fn().mockResolvedValue([]),
    getAccessLogs: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('./src/config', () => ({
  config: {
    port: 3007,
    nodeEnv: 'test',
    jwtSecret: 'test-secret',
    jwtIssuer: 'face-recognition',
    jwtAudience: 'face-recognition-users',
    serviceJwtSecret: 'test-service-jwt-secret',
    redisUrl: 'redis://localhost:6379/0',
    db: {
      host: 'localhost',
      port: 5432,
      database: 'automationdb_test',
      user: 'postgres',
      password: 'postgres',
    },
    services: {
      notificationService: 'http://notification-service:3006',
      borrowService: 'http://borrow-service:8000',
      scheduleService: 'http://schedule-service:3002',
      accessService: 'http://access-service:3003',
      userService: 'http://user-service:3001',
    },
    corsOrigins: ['*'],
  },
}));

jest.mock('./src/events/EventBus', () => ({
  eventBus: {
    on: jest.fn(),
    publish: jest.fn(),
    connect: jest.fn(),
  },
}));
