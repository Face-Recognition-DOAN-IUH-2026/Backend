jest.mock('./src/data-source', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
    createQueryRunner: jest.fn(),
  },
}));

jest.mock('./src/clients/UserServiceClient', () => ({
  UserServiceClient: jest.fn().mockImplementation(() => ({
    getUsers: jest.fn().mockResolvedValue(new Map()),
    getUser: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock('./src/realtime/RealtimeHub', () => ({
  realtimeHub: {
    publish: jest.fn(),
  },
}));
