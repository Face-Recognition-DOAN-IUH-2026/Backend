import { AuthController } from '../../controllers/AuthController';

jest.mock('../../services', () => ({
  authService: {
    register: jest.fn().mockResolvedValue({ access_token: 't', refresh_token: 'r', user: { id: '1' } }),
    login: jest.fn().mockResolvedValue({ access_token: 't', refresh_token: 'r', user: { id: '1' } }),
    forgotPassword: jest.fn().mockResolvedValue(undefined),
    resetPassword: jest.fn().mockResolvedValue(undefined),
    verifyResetCode: jest.fn().mockResolvedValue(true),
    verifyEmail: jest.fn().mockResolvedValue(undefined),
    resendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    refreshToken: jest.fn(),
    verifyToken: jest.fn(),
    getUserById: jest.fn(),
    requestEmailCorrection: jest.fn(),
    verifyEmailAndCorrect: jest.fn(),
  },
}));

function mockRes() {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
  return res;
}

describe('AuthController - zod input validation (#24)', () => {
  const controller = new AuthController();
  let res: any;

  beforeEach(() => {
    res = mockRes();
    jest.clearAllMocks();
  });

  it('register rejects malformed email with 400', async () => {
    await controller.register({ body: { email: 'not-an-email', password: 'password123' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('register rejects password shorter than 6 with 400', async () => {
    await controller.register({ body: { email: 'a@b.com', password: 'abc' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('register rejects unknown role values with 400', async () => {
    await controller.register({ body: { email: 'a@b.com', password: 'password123', role: 'superadmin' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('register accepts a valid payload and forwards it', async () => {
    const { authService } = require('../../services');
    await controller.register({ body: { email: 'a@b.com', password: 'password123', role: 'patron' } } as any, res);
    expect(authService.register).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('login rejects malformed email with 400', async () => {
    await controller.login({ body: { email: 'nope', password: 'password123' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('login rejects empty password with 400', async () => {
    await controller.login({ body: { email: 'a@b.com', password: '' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('forgotPassword rejects malformed email with 400', async () => {
    await controller.forgotPassword({ body: { email: 'nope' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('resetPassword rejects weak new password with 400', async () => {
    await controller.resetPassword({ body: { email: 'a@b.com', code: '123456', new_password: 'abc' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('resetPassword rejects malformed email with 400', async () => {
    await controller.resetPassword({ body: { email: 'nope', code: '123456', new_password: 'password123' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
