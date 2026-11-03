import express, { Express } from 'express';
import request from 'supertest';
import { createBookPriceRouter } from '../../routes/bookPrice.routes';
import { errorHandler } from '../../../../shared/error-handler';

/**
 * BLF-FEE-01 — staff manual book-price valuation.
 *
 * When a returned book has no cover price, staff can enter a valuation and
 * optionally write it back to books.price in the same transaction as the fine
 * record. Requires `books:update`; without it → 403 BOOK_PRICE_UPDATE_FORBIDDEN.
 */

jest.mock('../../middlewares/auth', () => ({
  auth: (req: any, res: any, next: any) => {
    if (!req.headers?.authorization) {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }
    req.user = { id: 'staff-1', email: 'staff@test.com', role: 'staff' };
    next();
  },
  requireDynamicPermission: (_resource: string, _action: string) =>
    (req: any, res: any, next: any) => {
      if (req.headers?.['x-test-role'] === 'patron') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      next();
    },
}));

describe('Book price valuation routes (BLF-FEE-01)', () => {
  let app: Express;
  let service: any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = {
      valueBookPrice: jest.fn(),
    };

    app = express();
    app.use(express.json());
    app.use('/borrow/books', createBookPriceRouter(service));
    app.use(errorHandler);
  });

  describe('POST /borrow/books/:bookId/price/value', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app)
        .post('/borrow/books/b1/price/value')
        .send({ value: 120000 });
      expect(res.status).toBe(401);
    });

    it('returns 403 when the caller lacks books:update', async () => {
      const res = await request(app)
        .post('/borrow/books/b1/price/value')
        .set('Authorization', 'Bearer valid')
        .set('x-test-role', 'patron')
        .send({ value: 120000 });

      expect(res.status).toBe(403);
      expect(service.valueBookPrice).not.toHaveBeenCalled();
    });

    it('rejects value <= 0 with 400', async () => {
      const res = await request(app)
        .post('/borrow/books/b1/price/value')
        .set('Authorization', 'Bearer valid')
        .send({ value: 0 });

      expect(res.status).toBe(400);
      expect(service.valueBookPrice).not.toHaveBeenCalled();
    });

    it('rejects missing value with 400', async () => {
      const res = await request(app)
        .post('/borrow/books/b1/price/value')
        .set('Authorization', 'Bearer valid')
        .send({});

      expect(res.status).toBe(400);
    });

    it('values the book and writes back when updateCoverPrice is true', async () => {
      service.valueBookPrice.mockResolvedValue({
        bookId: 'b1',
        valuedAt: 120000,
        coverPriceUpdated: true,
        priceUnavailableResolved: true,
      });

      const res = await request(app)
        .post('/borrow/books/b1/price/value')
        .set('Authorization', 'Bearer valid')
        .send({ value: 120000, updateCoverPrice: true });

      expect(res.status).toBe(200);
      expect(res.body.coverPriceUpdated).toBe(true);
      expect(service.valueBookPrice).toHaveBeenCalledWith(
        'b1',
        120000,
        true,
        'staff-1',
      );
    });

    it('values without writing back when updateCoverPrice is false', async () => {
      service.valueBookPrice.mockResolvedValue({
        bookId: 'b1',
        valuedAt: 120000,
        coverPriceUpdated: false,
        priceUnavailableResolved: true,
      });

      const res = await request(app)
        .post('/borrow/books/b1/price/value')
        .set('Authorization', 'Bearer valid')
        .send({ value: 120000, updateCoverPrice: false });

      expect(res.status).toBe(200);
      expect(res.body.coverPriceUpdated).toBe(false);
      expect(service.valueBookPrice).toHaveBeenCalledWith(
        'b1',
        120000,
        false,
        'staff-1',
      );
    });

    it('returns 404 when the book does not exist', async () => {
      service.valueBookPrice.mockRejectedValue(
        new (require('../../../../shared/error-handler').HttpError)(
          404,
          'Không tìm thấy sách',
          'BOOK_NOT_FOUND',
        ),
      );

      const res = await request(app)
        .post('/borrow/books/MISSING/price/value')
        .set('Authorization', 'Bearer valid')
        .send({ value: 120000 });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('BOOK_NOT_FOUND');
    });

    it('returns 403 BOOK_PRICE_UPDATE_FORBIDDEN when write-back is rejected', async () => {
      service.valueBookPrice.mockRejectedValue(
        new (require('../../../../shared/error-handler').HttpError)(
          403,
          'Bạn không có quyền cập nhật giá bìa sách',
          'BOOK_PRICE_UPDATE_FORBIDDEN',
        ),
      );

      const res = await request(app)
        .post('/borrow/books/b1/price/value')
        .set('Authorization', 'Bearer valid')
        .send({ value: 120000, updateCoverPrice: true });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('BOOK_PRICE_UPDATE_FORBIDDEN');
    });
  });
});
