import express, { Express } from 'express';
import request from 'supertest';
import borrowRoutes from '../../routes/borrow.routes';
import { errorHandler } from '../../../../shared/error-handler';
import * as AccessServiceClient from '../../clients/AccessServiceClient';
import { PATRON_UUID } from '../helpers/auth';

const mockBorrowRepo = {
  getCopyByBarcode: jest.fn().mockResolvedValue(null),
};

jest.mock('../../middlewares/auth', () => ({
  auth: (req: any, _res: any, next: any) => {
    const token = req.headers?.authorization?.replace('Bearer ', '');
    if (!token || token === 'invalid-token') {
      _res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }
    const role = req.headers['x-test-role'] || 'patron';
    req.user = { id: PATRON_UUID, email: 'patron@test.com', role };
    next();
  },
  requireRole: (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
  requireDynamicPermission: () => (req: any, res: any, next: any) => {
    if (req.headers['x-test-deny-permission']) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }
    next();
  },
}));

// Keep the real `shouldTouchPresence` (cooldown logic) but control
// `getPatronAccessStatus` and `touchPatronPresence` per test.
jest.mock('../../clients/AccessServiceClient', () => {
  const real = jest.requireActual('../../clients/AccessServiceClient');
  return {
    ...real,
    getPatronAccessStatus: jest.fn(),
    touchPatronPresence: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockBorrowRepo),
}));

jest.mock('../../clients/UserServiceClient');

const mockAccessService = AccessServiceClient as jest.Mocked<typeof AccessServiceClient> & {
  getPatronAccessStatus: jest.Mock;
  touchPatronPresence: jest.Mock;
};

/**
 * BLF-PRES-01 — presence auto-touch on borrow.
 */
describe('Borrow presence touch (BLF-PRES-01)', () => {
  let app: Express;

  const recent = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago (within cooldown)
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago (outside cooldown)

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/borrow', borrowRoutes);
    app.use(errorHandler);
  });

  async function postBarcode(barcode: string, role = 'patron', token = 'valid-token') {
    return request(app)
      .post('/borrow/')
      .set('Authorization', `Bearer ${token}`)
      .set('x-test-role', role)
      .send({ barcode });
  }

  it('touches presence when inside, not expired, and lastEntryAt is stale/null', async () => {
    mockAccessService.getPatronAccessStatus.mockResolvedValue({
      inside: true,
      isExpired: false,
      lastEntryAt: null,
      source: 'access-service',
    });

    const res = await postBarcode('LIB-001');

    expect(mockAccessService.touchPatronPresence).toHaveBeenCalledTimes(1);
    expect(mockAccessService.touchPatronPresence).toHaveBeenCalledWith(PATRON_UUID);
    // Copy doesn't exist -> 404, but touch already happened.
    expect(res.status).toBe(404);
  });

  it('does NOT touch presence when the session is expired (no revive)', async () => {
    mockAccessService.getPatronAccessStatus.mockResolvedValue({
      inside: false,
      isExpired: true,
      lastEntryAt: stale,
      source: 'expired',
    });

    const res = await postBarcode('LIB-001');

    expect(res.status).toBe(403);
    expect(res.body.detail || res.body.error || '').toMatch(/h[eế]t h[aạ]n/i);
    expect(mockAccessService.touchPatronPresence).not.toHaveBeenCalled();
  });

  it('does NOT touch presence when lastEntryAt is within cooldown', async () => {
    mockAccessService.getPatronAccessStatus.mockResolvedValue({
      inside: true,
      isExpired: false,
      lastEntryAt: recent,
      source: 'access-service',
    });

    const res = await postBarcode('LIB-001');

    expect(mockAccessService.touchPatronPresence).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });

  it('touches presence when lastEntryAt is stale (outside cooldown)', async () => {
    mockAccessService.getPatronAccessStatus.mockResolvedValue({
      inside: true,
      isExpired: false,
      lastEntryAt: stale,
      source: 'access-service',
    });

    const res = await postBarcode('LIB-001');

    expect(mockAccessService.touchPatronPresence).toHaveBeenCalledTimes(1);
    expect(mockAccessService.touchPatronPresence).toHaveBeenCalledWith(PATRON_UUID);
    expect(res.status).toBe(404);
  });

  it('does not touch presence when patron is not inside (not expired)', async () => {
    mockAccessService.getPatronAccessStatus.mockResolvedValue({
      inside: false,
      isExpired: false,
      lastEntryAt: stale,
      source: 'not-found',
    });

    const res = await postBarcode('LIB-001');

    expect(res.status).toBe(403);
    expect(mockAccessService.touchPatronPresence).not.toHaveBeenCalled();
  });
});
