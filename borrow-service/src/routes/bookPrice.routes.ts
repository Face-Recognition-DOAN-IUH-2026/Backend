import { Router } from 'express';
import { z } from 'zod';
import { auth, AuthRequest, requireDynamicPermission } from '../middlewares/auth';
import { HttpError } from '../../../shared/error-handler';
import { PriceValuationService } from '../services/PriceValuationService';

export function createBookPriceRouter(
  service: PriceValuationService = new PriceValuationService(),
): Router {
  const router = Router();

  /**
   * POST /borrow/books/:bookId/price/value
   * Staff-only: value an unpriced book. Optionally write the value back to
   * books.price in the same transaction as the fine-record damage update.
   * Requires books:update; without it → 403 BOOK_PRICE_UPDATE_FORBIDDEN.
   */
  router.post(
    '/:bookId/price/value',
    auth,
    requireDynamicPermission('books', 'update'),
    async (req: AuthRequest, res, next) => {
      try {
        const { bookId } = req.params;
        if (!bookId) {
          throw new HttpError(400, 'Thiếu bookId');
        }

        const body = z.object({
          value: z.coerce.number().positive('Giá phải lớn hơn 0'),
          updateCoverPrice: z.boolean().optional(),
        }).parse(req.body ?? {});

        const result = await service.valueBookPrice(
          bookId,
          body.value,
          body.updateCoverPrice ?? false,
          req.user?.id || 'staff',
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export default createBookPriceRouter();
