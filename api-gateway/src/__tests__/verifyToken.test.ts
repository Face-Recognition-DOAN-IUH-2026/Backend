import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Mock jwt.verify
jest.mock('jsonwebtoken');

describe('verifyToken', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = { headers: {} as any };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 if no token provided', async () => {
    const { verifyToken } = await import('../index');
    verifyToken(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
  });

  it('should return 401 if token is invalid', async () => {
    req.headers!.authorization = 'Bearer invalid-token';
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('Invalid token');
    });

    const { verifyToken } = await import('../index');
    verifyToken(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should call next if token is valid', async () => {
    req.headers!.authorization = 'Bearer valid-token';
    (jwt.verify as jest.Mock).mockReturnValue({ userId: '123' });

    const { verifyToken } = await import('../index');
    verifyToken(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });
});
