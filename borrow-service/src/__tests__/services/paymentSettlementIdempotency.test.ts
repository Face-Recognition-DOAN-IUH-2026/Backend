import { PaymentService } from '../../services/PaymentService';
import { AppDataSource } from '../../data-source';
import { VietqrCallback } from '../../entities/VietqrCallback';
import * as eventPublisher from '../../utils/eventPublisher';
import * as userServiceClient from '../../clients/UserServiceClient';

jest.mock('../../data-source');
jest.mock('../../utils/eventPublisher');
jest.mock('../../clients/UserServiceClient');

/**
 * BLF-PAY-01 — settlement must be idempotent and non-destructive.
 *
 * The defect: a VietQR payment that arrives after the patron already paid at
 * the counter used to overwrite payment_ref / payment_method / paid_at on the
 * already-settled record and publish a second `payment.completed` event.
 *
 * A payment for an already-settled debt must instead be quarantined as
 * `reconcile_needed` so staff can refund it (decision D4).
 */
describe('PaymentService settlement idempotency (BLF-PAY-01)', () => {
  let service: PaymentService;
  let mockRepo: any;
  let mockOrderRepo: any;
  let orderStore: Map<string, any>;
  // Jest records references, not snapshots, and the service mutates the same
  // order object twice (settle then compensate). Capture the status at each
  // save call so the write sequence can be asserted faithfully.
  let savedStatuses: string[];

  const buildRecord = (overrides: Record<string, any> = {}) => ({
    id: 'rec-1',
    patronId: 'patron-1',
    fineAmount: 50000,
    damageFee: 0,
    finePaid: false,
    paymentMethod: null,
    paymentRef: null,
    paidAt: null,
    ...overrides,
  });

  const buildOrder = (overrides: Record<string, any> = {}) => ({
    id: 'order-1',
    orderCode: 'TXN-20261102-AAAA1111',
    patronId: 'patron-1',
    amount: 50000,
    status: 'pending',
    paymentMethod: 'vietqr',
    recordIds: ['rec-1'],
    gatewayTransId: null,
    webhookPayload: null,
    paidAt: null,
    ...overrides,
  });

  let callbackRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    // No webhook secret => signature is not required, keeping these tests focused
    // on the settlement rules rather than on HMAC plumbing.
    delete process.env.PAYOS_CHECKSUM_KEY;
    delete process.env.PAYMENT_WEBHOOK_SECRET;

    orderStore = new Map();
    savedStatuses = [];

    const callbackStore: any[] = [];
    callbackRepo = {
      create: jest.fn((data: any) => ({ id: 'cb-1', ...data })),
      save: jest.fn(async (row: any) => {
        callbackStore.push(row);
        return row;
      }),
      findOne: jest.fn(async ({ where }: any) =>
        callbackStore.find((row) => row.transactionId === where.transactionId) ?? null),
    };

    mockRepo = {
      findFineRecordsByIds: jest.fn(),
      saveBorrowRecords: jest.fn(async (records: any[]) => records),
      hasUnpaidFinesForPatron: jest.fn().mockResolvedValue(true),
    };

    mockOrderRepo = {
      create: jest.fn((data: any) => ({ id: 'order-1', ...data })),
      save: jest.fn(async (order: any) => {
        savedStatuses.push(order.status);
        orderStore.set(order.orderCode, order);
        return order;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        const [key, value] = Object.entries(where ?? {})[0] ?? [];
        if (key === 'orderCode') return orderStore.get(value as string) ?? null;
        if (key === 'vietqrOrderId') {
          return [...orderStore.values()].find((o) => o.vietqrOrderId === value) ?? null;
        }
        return null;
      }),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn(async ({ where, skip = 0, take = 20 }: any) => {
        const all = [...orderStore.values()].filter((o) => o.status === where.status);
        return [all.slice(skip, skip + take), all.length];
      }),
    };

    (AppDataSource.getRepository as jest.Mock) = jest.fn((entity: any) =>
      entity === VietqrCallback ? callbackRepo : mockOrderRepo);

    service = new PaymentService(mockRepo);
  });

  const webhook = (orderCode: string, amount = 50000) =>
    service.processWebhook({ orderCode, amount });

  describe('when every record was already paid at the counter', () => {
    it('quarantines the order instead of overwriting the settled record', async () => {
      const counterPaidAt = new Date('2026-11-02T03:00:00Z');
      const record = buildRecord({
        finePaid: true,
        paymentMethod: 'cash',
        paymentRef: 'TXN-COUNTER-1',
        paidAt: counterPaidAt,
      });
      orderStore.set('TXN-20261102-AAAA1111', buildOrder());
      mockRepo.findFineRecordsByIds.mockResolvedValue([record]);

      const result: any = await webhook('TXN-20261102-AAAA1111');

      expect(result.success).toBe(true);
      expect(result.alreadyCompleted).toBe(false);
      expect(result.reconcile).toEqual(expect.objectContaining({
        reason: 'all_records_already_paid',
        amount: 50000,
        alreadyPaidRecordIds: ['rec-1'],
        settledRecordIds: [],
      }));

      // The counter payment must be preserved byte for byte.
      expect(record.paymentMethod).toBe('cash');
      expect(record.paymentRef).toBe('TXN-COUNTER-1');
      expect(record.paidAt).toBe(counterPaidAt);

      // Nothing was settled, so no borrow-record write should happen at all.
      expect(mockRepo.saveBorrowRecords).not.toHaveBeenCalled();

      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        status: 'reconcile_needed',
        reconcileReason: 'all_records_already_paid',
        reconcileAmount: 50000,
        alreadyPaidRecordIds: ['rec-1'],
        settledRecordIds: [],
      }));
    });

    it('publishes payment.reconcile_needed with the refundable amount', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder());
      mockRepo.findFineRecordsByIds.mockResolvedValue([
        buildRecord({ finePaid: true, paymentMethod: 'cash', paymentRef: 'TXN-COUNTER-1' }),
      ]);

      await webhook('TXN-20261102-AAAA1111');

      expect(eventPublisher.publishEvent).toHaveBeenCalledWith(
        'payment.reconcile_needed',
        expect.objectContaining({
          orderCode: 'TXN-20261102-AAAA1111',
          patronId: 'patron-1',
          amount: 50000,
          reason: 'all_records_already_paid',
          alreadyPaidRecordIds: ['rec-1'],
        }),
      );
    });

    it('does not publish payment.completed when nothing was settled', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder());
      mockRepo.findFineRecordsByIds.mockResolvedValue([
        buildRecord({ finePaid: true, paymentMethod: 'cash', paymentRef: 'TXN-COUNTER-1' }),
      ]);

      await webhook('TXN-20261102-AAAA1111');

      const publishedTypes = (eventPublisher.publishEvent as jest.Mock).mock.calls
        .map((call) => call[0]);
      expect(publishedTypes).not.toContain('payment.completed');
    });

    it('sums the refundable amount from fine plus damage on the paid records', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder({ recordIds: ['rec-1', 'rec-2'] }));
      mockRepo.findFineRecordsByIds.mockResolvedValue([
        buildRecord({ id: 'rec-1', fineAmount: 20000, damageFee: 5000, finePaid: true }),
        buildRecord({ id: 'rec-2', fineAmount: 0, damageFee: 35000, finePaid: true }),
      ]);

      const result: any = await webhook('TXN-20261102-AAAA1111');

      expect(result.reconcile.amount).toBe(60000);
      expect(result.reconcile.alreadyPaidRecordIds).toEqual(['rec-1', 'rec-2']);
    });
  });

  describe('when only part of the debt was already paid', () => {
    it('settles only the unpaid subset and leaves the paid record untouched', async () => {
      const counterPaidAt = new Date('2026-11-02T03:00:00Z');
      const alreadyPaid = buildRecord({
        id: 'rec-1',
        fineAmount: 20000,
        damageFee: 0,
        finePaid: true,
        paymentMethod: 'cash',
        paymentRef: 'TXN-COUNTER-1',
        paidAt: counterPaidAt,
      });
      const stillOwed = buildRecord({
        id: 'rec-2',
        fineAmount: 0,
        damageFee: 35000,
        finePaid: false,
      });

      orderStore.set('TXN-20261102-AAAA1111', buildOrder({ recordIds: ['rec-1', 'rec-2'] }));
      mockRepo.findFineRecordsByIds.mockResolvedValue([alreadyPaid, stillOwed]);

      const result: any = await webhook('TXN-20261102-AAAA1111');

      expect(result.reconcile).toEqual(expect.objectContaining({
        reason: 'partial_already_paid',
        amount: 20000,
        alreadyPaidRecordIds: ['rec-1'],
        settledRecordIds: ['rec-2'],
      }));

      // Counter payment untouched.
      expect(alreadyPaid.paymentMethod).toBe('cash');
      expect(alreadyPaid.paymentRef).toBe('TXN-COUNTER-1');
      expect(alreadyPaid.paidAt).toBe(counterPaidAt);

      // The unpaid record is settled by the online payment.
      expect(stillOwed.finePaid).toBe(true);
      expect(stillOwed.paymentRef).toBe('TXN-20261102-AAAA1111');

      // Only the settleable subset is written.
      expect(mockRepo.saveBorrowRecords).toHaveBeenCalledWith([stillOwed]);

      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        status: 'reconcile_needed',
        reconcileReason: 'partial_already_paid',
      }));
    });
  });

  describe('when nothing was paid before', () => {
    it('settles normally and does not create a reconcile ticket', async () => {
      const record = buildRecord();
      orderStore.set('TXN-20261102-AAAA1111', buildOrder());
      mockRepo.findFineRecordsByIds.mockResolvedValue([record]);
      mockRepo.hasUnpaidFinesForPatron.mockResolvedValue(false);

      const result: any = await webhook('TXN-20261102-AAAA1111');

      expect(result.alreadyCompleted).toBe(false);
      expect(result.reconcile).toBeUndefined();
      expect(result.activatedPatrons).toEqual(['patron-1']);

      expect(record.finePaid).toBe(true);
      expect(record.paymentRef).toBe('TXN-20261102-AAAA1111');

      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
        settledRecordIds: ['rec-1'],
      }));

      const publishedTypes = (eventPublisher.publishEvent as jest.Mock).mock.calls
        .map((call) => call[0]);
      expect(publishedTypes).toContain('payment.completed');
      expect(publishedTypes).not.toContain('payment.reconcile_needed');
      expect(userServiceClient.activateCardAutoFine).toHaveBeenCalledWith('patron-1');
    });
  });

  describe('replay and terminal states', () => {
    it('is idempotent when the order is already in reconcile_needed', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder({ status: 'reconcile_needed' }));
      mockRepo.findFineRecordsByIds.mockResolvedValue([buildRecord({ finePaid: true })]);

      const result: any = await webhook('TXN-20261102-AAAA1111');

      expect(result.alreadyCompleted).toBe(true);
      expect(mockRepo.saveBorrowRecords).not.toHaveBeenCalled();
      expect(mockOrderRepo.save).not.toHaveBeenCalled();
      expect(eventPublisher.publishEvent).not.toHaveBeenCalled();
    });

    it('is idempotent when the order is already refunded', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder({ status: 'refunded' }));

      const result: any = await webhook('TXN-20261102-AAAA1111');

      expect(result.alreadyCompleted).toBe(true);
      expect(mockRepo.saveBorrowRecords).not.toHaveBeenCalled();
    });

    it('does not mutate records when the order was cancelled', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder({ status: 'cancelled' }));
      mockRepo.findFineRecordsByIds.mockResolvedValue([buildRecord()]);

      const result: any = await webhook('TXN-20261102-AAAA1111');

      expect(result.alreadyCompleted).toBe(true);
      expect(mockRepo.saveBorrowRecords).not.toHaveBeenCalled();
      expect(mockOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('write failure keeps the order retryable', () => {
    it('leaves the order unsettled (never completed) when the record write fails', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder());
      mockRepo.findFineRecordsByIds.mockResolvedValue([buildRecord()]);
      mockRepo.saveBorrowRecords.mockRejectedValue(new Error('db write failed'));

      await expect(webhook('TXN-20261102-AAAA1111')).rejects.toThrow('db write failed');

      // Records are written before the order, so a failure can never produce
      // "order completed but debt unpaid".
      expect(savedStatuses).not.toContain('completed');
      expect(orderStore.get('TXN-20261102-AAAA1111')?.status).toBe('pending');
    });

    it('leaves the order retryable when the partial write fails', async () => {
      orderStore.set(
        'TXN-20261102-AAAA1111',
        buildOrder({ recordIds: ['rec-1', 'rec-2'] }),
      );
      mockRepo.findFineRecordsByIds.mockResolvedValue([
        buildRecord({ id: 'rec-1', finePaid: true, paymentMethod: 'cash', paymentRef: 'TXN-COUNTER-1' }),
        buildRecord({ id: 'rec-2', fineAmount: 35000, finePaid: false }),
      ]);
      mockRepo.saveBorrowRecords.mockRejectedValue(new Error('db write failed'));

      await expect(webhook('TXN-20261102-AAAA1111')).rejects.toThrow('db write failed');

      // No ticket may survive for records that were never actually settled.
      const stored = orderStore.get('TXN-20261102-AAAA1111');
      expect(stored?.status).toBe('pending');
      expect(stored?.settledRecordIds).toBeUndefined();
      expect(stored?.reconcileReason).toBeUndefined();
    });
  });

  describe('confirmManualReceipt with a reconcile_needed order', () => {
    it('treats it as already completed instead of throwing', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder({ status: 'reconcile_needed' }));

      const result: any = await service.confirmManualReceipt('TXN-20261102-AAAA1111', 'staff-1');

      expect(result.alreadyCompleted).toBe(true);
      expect(mockRepo.saveBorrowRecords).not.toHaveBeenCalled();
    });
  });

  describe('crash recovery between the record write and the order save', () => {
    it('recovers its own earlier write instead of raising a false refund ticket', async () => {
      const ownWrite = buildRecord({
        finePaid: true,
        paymentMethod: 'vietqr',
        paymentRef: 'TXN-20261102-AAAA1111',
        paidAt: new Date('2026-11-02T03:00:00Z'),
      });
      orderStore.set('TXN-20261102-AAAA1111', buildOrder());
      mockRepo.findFineRecordsByIds.mockResolvedValue([ownWrite]);
      mockRepo.hasUnpaidFinesForPatron.mockResolvedValue(false);

      const result: any = await webhook('TXN-20261102-AAAA1111');

      expect(result.reconcile).toBeUndefined();
      expect(savedStatuses).toContain('completed');

      const publishedTypes = (eventPublisher.publishEvent as jest.Mock).mock.calls
        .map((call) => call[0]);
      expect(publishedTypes).not.toContain('payment.reconcile_needed');
    });
  });

  describe('orders with no resolvable records', () => {
    it('opens a reconcile ticket instead of silently completing', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder());
      mockRepo.findFineRecordsByIds.mockResolvedValue([]);

      const result: any = await webhook('TXN-20261102-AAAA1111');

      expect(result.reconcile).toEqual(expect.objectContaining({
        reason: 'records_missing',
        amount: 50000,
        settledRecordIds: [],
      }));
      expect(savedStatuses).toContain('reconcile_needed');
      expect(savedStatuses).not.toContain('completed');
    });
  });

  describe('late bank transfer for an expired order', () => {
    it('still settles the debt', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder({ status: 'expired' }));
      const record = buildRecord();
      mockRepo.findFineRecordsByIds.mockResolvedValue([record]);
      mockRepo.hasUnpaidFinesForPatron.mockResolvedValue(false);

      const result: any = await webhook('TXN-20261102-AAAA1111');

      expect(result.alreadyCompleted).toBe(false);
      expect(record.finePaid).toBe(true);
      expect(savedStatuses).toContain('completed');
    });
  });

  describe('processVietqrCallback against a settled order', () => {
    it('flags the second transfer for refund and answers duplicate', async () => {
      orderStore.set(
        'TXN-20261102-AAAA1111',
        buildOrder({ status: 'completed', vietqrOrderId: 'VQR123456789' }),
      );

      const result = await service.processVietqrCallback({
        transactionid: 'BANK-TX-2',
        amount: 50000,
        orderId: 'VQR123456789',
      });

      expect(result.duplicate).toBe(true);
      expect(mockRepo.saveBorrowRecords).not.toHaveBeenCalled();

      expect(eventPublisher.publishEvent).toHaveBeenCalledWith(
        'payment.reconcile_needed',
        expect.objectContaining({
          orderCode: 'TXN-20261102-AAAA1111',
          amount: 50000,
          reason: 'duplicate_transfer_after_settlement',
          source: 'vietqr_callback',
        }),
      );
    });
  });

  describe('acknowledgeReconcile', () => {
    it('closes the ticket, records the staff member and publishes the event', async () => {
      orderStore.set(
        'TXN-20261102-AAAA1111',
        buildOrder({ status: 'reconcile_needed', reconcileAmount: 50000 }),
      );

      const result = await service.acknowledgeReconcile(
        'TXN-20261102-AAAA1111',
        'staff-9',
        'Da chuyen khoan hoan tien',
      );

      expect(result).toEqual(expect.objectContaining({
        status: 'refunded',
        alreadyAcknowledged: false,
        reconcileAckBy: 'staff-9',
      }));

      const stored = orderStore.get('TXN-20261102-AAAA1111');
      expect(stored.status).toBe('refunded');
      expect(stored.reconcileAckNote).toBe('Da chuyen khoan hoan tien');
      expect(stored.reconcileAckAt).toBeInstanceOf(Date);

      expect(eventPublisher.publishEvent).toHaveBeenCalledWith(
        'payment.refund_acknowledged',
        expect.objectContaining({ orderCode: 'TXN-20261102-AAAA1111', acknowledgedBy: 'staff-9' }),
      );
    });

    it('is a no-op on an already refunded order', async () => {
      orderStore.set(
        'TXN-20261102-AAAA1111',
        buildOrder({ status: 'refunded', reconcileAckBy: 'staff-1' }),
      );

      const result = await service.acknowledgeReconcile('TXN-20261102-AAAA1111', 'staff-2', 'lan hai');

      expect(result.alreadyAcknowledged).toBe(true);
      expect(result.reconcileAckBy).toBe('staff-1');
      expect(savedStatuses).toEqual([]);
      expect(eventPublisher.publishEvent).not.toHaveBeenCalled();
    });

    it('rejects an order that does not need reconciliation', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder({ status: 'completed' }));

      await expect(
        service.acknowledgeReconcile('TXN-20261102-AAAA1111', 'staff-2', 'nham don'),
      ).rejects.toMatchObject({ statusCode: 409, code: 'ORDER_NOT_IN_RECONCILE' });
    });

    it('throws 404 for an unknown order', async () => {
      await expect(
        service.acknowledgeReconcile('TXN-MISSING', 'staff-2', 'khong ton tai'),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('listReconcileOrders', () => {
    it('filters by status, paginates and clamps the page size', async () => {
      orderStore.set('TXN-A', buildOrder({ orderCode: 'TXN-A', status: 'reconcile_needed' }));
      orderStore.set('TXN-B', buildOrder({ orderCode: 'TXN-B', status: 'reconcile_needed' }));
      orderStore.set('TXN-C', buildOrder({ orderCode: 'TXN-C', status: 'completed' }));

      const page1 = await service.listReconcileOrders({ page: 1, pageSize: 1 });
      expect(page1.total).toBe(2);
      expect(page1.items).toHaveLength(1);
      expect(page1.pageSize).toBe(1);

      const refunded = await service.listReconcileOrders({ status: 'refunded' });
      expect(refunded.total).toBe(0);

      const clamped = await service.listReconcileOrders({ pageSize: 5000 });
      expect(clamped.pageSize).toBe(100);
    });
  });

  describe('getOrderStatus', () => {
    it('explains why a reconcile_needed order is stuck', async () => {
      orderStore.set(
        'TXN-20261102-AAAA1111',
        buildOrder({
          status: 'reconcile_needed',
          reconcileReason: 'all_records_already_paid',
          reconcileAmount: 50000,
        }),
      );

      const status = await service.getOrderStatus('TXN-20261102-AAAA1111');

      expect(status.reconcile).toEqual({
        reason: 'all_records_already_paid',
        amount: 50000,
        requiresStaffAction: true,
      });
    });

    it('omits the reconcile block for a normal order', async () => {
      orderStore.set('TXN-20261102-AAAA1111', buildOrder());

      const status = await service.getOrderStatus('TXN-20261102-AAAA1111');

      expect(status.reconcile).toBeUndefined();
    });
  });
});
