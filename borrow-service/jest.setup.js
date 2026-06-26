require('reflect-metadata');

jest.mock('./src/clients/AccessServiceClient');
jest.mock('./src/clients/UserServiceClient');
jest.mock('./src/clients/GoogleBooksClient');
jest.mock('./src/clients/OpenLibraryClient');

jest.mock('./src/data-source', () => ({
  AppDataSource: {
    initialize: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn().mockImplementation(async (fn) => {
      const mockManager = {
        save: jest.fn().mockImplementation(async (entity) => entity),
      };
      return fn(mockManager);
    }),
    getRepository: jest.fn().mockReturnValue({
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        getMany: jest.fn().mockResolvedValue([]),
        getRawMany: jest.fn().mockResolvedValue([]),
        getRawOne: jest.fn().mockResolvedValue(null),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
      }),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      remove: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    }),
  },
}));

jest.mock('./src/config', () => ({
  config: {
    serviceName: 'borrow-service',
    port: 8000,
    nodeEnv: 'test',
    postgres: {
      host: 'localhost',
      port: 5432,
      database: 'borrowdb_test',
      username: 'postgres',
      password: 'postgres',
    },
    userServiceUrl: 'http://user-service:3001',
    accessServiceUrl: 'http://access-service:3003',
    internalApiKey: 'test-internal-key',
    jwtSecret: 'test-secret-key-for-jwt-signing-minimum-32-chars',
    jwtIssuer: 'face-recognition',
    jwtAudience: 'face-recognition-users',
    maxEntryHours: 24,
    maxBorrowDays: 14,
    maxBorrowBooks: 3,
    maxBorrowBooksPerSlip: 5,
    finePerDay: 5000,
    maxRenewals: 1,
    reservationExpiryHours: 24,
  },
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockImplementation((payload) => {
    return 'mock.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  }),
  verify: jest.fn().mockImplementation((token) => {
    if (token === 'expired-token' || token === 'invalid-token') {
      throw new Error('Token expired or invalid');
    }
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          throw new Error('jwt expired');
        }
        return payload;
      }
    } catch (e) {
      if (e && e.message === 'jwt expired') throw e;
    }
    return {
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'test@example.com',
      roles: ['patron'],
      aud: 'face-recognition-users',
      iss: 'face-recognition',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
  }),
}));