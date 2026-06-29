require('reflect-metadata');

jest.mock('./src/config', () => ({
  config: {
    port: 3006,
    nodeEnv: 'test',
    jwtSecret: 'test-secret',
    jwtIssuer: 'face-recognition',
    jwtAudience: 'face-recognition-users',
    serviceJwtSecret: 'test-service-jwt-secret',
    redisUrl: 'redis://localhost:6379/0',
    db: {
      host: 'localhost',
      port: 5432,
      database: 'notificationdb_test',
      user: 'postgres',
      password: 'postgres',
    },
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: 'test@gmail.com',
      pass: 'test-password',
      from: 'test@gmail.com',
    },
    corsOrigins: ['*'],
  },
}));

jest.mock('./src/services/NotificationService', () => ({
  notificationService: {
    create: jest.fn().mockResolvedValue({ id: 'mock-notif-id', type: 'test', title: 'test', body: 'test' }),
    createMany: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    findByUser: jest.fn().mockResolvedValue([]),
    markAsRead: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('./src/realtime/NotificationHub', () => ({
  notificationHub: {
    publish: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn(),
  },
}));

jest.mock('./src/data-source', () => ({
  AppDataSource: {
    initialize: jest.fn().mockResolvedValue(true),
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
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
      }),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      create: jest.fn().mockImplementation((data) => data),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    }),
  },
}));
