jest.mock('../src/data-source', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
    createQueryRunner: jest.fn(),
  },
}));

jest.mock('../src/services/RedisService', () => ({
  RedisService: jest.fn().mockImplementation(() => ({
    publishUserDeleted: jest.fn(),
    publishUserUpdated: jest.fn(),
    setPasswordResetCode: jest.fn(),
    getPasswordResetCode: jest.fn(),
    deletePasswordResetCode: jest.fn(),
  })),
}));

jest.mock('../src/clients/BorrowServiceClient', () => ({
  checkActiveBorrows: jest.fn().mockResolvedValue({ hasActive: false }),
}));

jest.mock('../src/clients/FaceServiceClient', () => ({
  faceServiceClient: {
    checkEnrollment: jest.fn().mockResolvedValue(false),
  },
}));

jest.mock('../src/config', () => ({
  config: {
    jwtSecret: 'test-secret',
    jwtRefreshSecret: 'test-refresh-secret',
    jwtIssuer: 'test-issuer',
    jwtAudience: 'test-audience',
    jwtAccessExpiresMinutes: 15,
    jwtRefreshExpiresDays: 30,
    notificationServiceUrl: 'http://notification-service:3006',
    faceRecognitionServiceUrl: 'http://face-recognition-service:5000',
    serviceJwtSecret: 'test-service-jwt-secret',
  },
}));
