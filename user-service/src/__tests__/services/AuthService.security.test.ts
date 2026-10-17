import { AuthService } from '../../services/AuthService';
import { UserRepository } from '../../repositories/UserRepository';
import { RedisService } from '../../services/RedisService';

jest.mock('../../config', () => ({
  config: {
    jwtSecret: 'test-secret',
    jwtRefreshSecret: 'test-refresh-secret',
    jwtIssuer: 'test-issuer',
    jwtAudience: 'test-audience',
    jwtAccessExpiresMinutes: 15,
    jwtRefreshExpiresDays: 30,
    notificationServiceUrl: 'http://localhost:9999',
  },
}));

jest.mock('../../repositories/UserRepository');
jest.mock('../../services/RedisService');
jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ data: {} }),
}));
jest.mock('../../clients/AmqpClient', () => ({
  amqpClient: { publish: jest.fn().mockResolvedValue(undefined), connect: jest.fn() },
}));

describe('AuthService - registration privilege escalation guards', () => {
  let authService: AuthService;
  let userRepo: jest.Mocked<UserRepository>;
  let redis: jest.Mocked<RedisService>;

  function baseDto(overrides?: Record<string, any>) {
    return {
      email: 'new@library.local',
      password: 'password123',
      fullName: 'New User',
      role: 'patron',
      ...overrides,
    } as any;
  }

  beforeEach(() => {
    userRepo = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findByStudentCode: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (data) => ({
        id: '1',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findById: jest.fn(),
      update: jest.fn(),
    } as any;

    redis = {
      setEmailVerificationCode: jest.fn(),
      setPasswordResetCode: jest.fn(),
      getPasswordResetCode: jest.fn(),
      deletePasswordResetCode: jest.fn(),
    } as any;

    authService = new AuthService(userRepo, redis);
  });

  it('REJECTS staff creating an admin account', async () => {
    await expect(authService.register(baseDto({ role: 'admin' }), 'staff')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(userRepo.create).not.toHaveBeenCalled();
  });

  it('REJECTS unknown role values', async () => {
    await expect(authService.register(baseDto({ role: 'superadmin' }), 'admin')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(userRepo.create).not.toHaveBeenCalled();
  });

  it('IGNORES skipVerification for non-admin callers (staff-created users stay unverified)', async () => {
    await authService.register(baseDto({ skipVerification: true }), 'staff');

    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unverified' })
    );
  });

  it('ALLOWS admin to create an active admin account with skipVerification', async () => {
    await authService.register(baseDto({ role: 'admin', skipVerification: true }), 'admin');

    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin', status: 'active' })
    );
  });

  it('KEEPS allowing patron/user/staff creation for staff callers', async () => {
    await authService.register(baseDto({ role: 'patron' }), 'staff');
    await expect(authService.register(baseDto({ email: 'x@library.local', role: 'user' }), 'staff')).resolves.toBeDefined();
    expect(userRepo.create).toHaveBeenCalledTimes(2);
  });

  it('KEEPS default role "user" when omitted (no caller context)', async () => {
    await authService.register(baseDto({ role: undefined }));
    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user' })
    );
  });
});
