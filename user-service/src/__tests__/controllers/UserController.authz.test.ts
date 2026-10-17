import { UserController } from '../../controllers/UserController';

jest.mock('../../services', () => ({
  userService: {
    getUserById: jest.fn().mockResolvedValue({ id: 'u2', email: 'target@library.local' }),
    getAllUsers: jest.fn(),
  },
}));

function mockRes() {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('UserController.getById - authorization (#10)', () => {
  const controller = new UserController();
  let res: any;

  beforeEach(() => {
    res = mockRes();
    jest.clearAllMocks();
  });

  it('DENIES a patron reading another user profile (403, no data)', async () => {
    const { userService } = require('../../services');
    await controller.getById({ params: { id: 'u2' }, user: { userId: 'u1', role: 'patron' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(userService.getUserById).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }));
  });

  it('ALLOWS a user reading their own profile', async () => {
    await controller.getById({ params: { id: 'u1' }, user: { userId: 'u1', role: 'patron' } } as any, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }));
  });

  it('ALLOWS an admin reading any profile', async () => {
    await controller.getById({ params: { id: 'u2' }, user: { userId: 'a1', role: 'admin' } } as any, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }));
  });

  it('DENIES a staff member reading another user profile', async () => {
    await controller.getById({ params: { id: 'u2' }, user: { userId: 's1', role: 'staff' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
