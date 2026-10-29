import express, { Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { createPaymentRouter } from '../../routes/payment.routes';
import borrowRoutes from '../../routes/borrow.routes';
import { PaymentService } from '../../services/PaymentService';
import { AppDataSource } from '../../data-source';
import * as eventPublisher from '../../utils/eventPublisher';
import * as userServiceClient from '../../clients/UserServiceClient';
import { errorHandler } from '../../../../shared/error-handler';

jest.mock('../../data-source');
jest.mock('../../utils/eventPublisher');
jest.mock('../../clients/UserServiceClient');

// Mock auth middleware to simulate authenticated patron
const mockPatronId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const recId1 = 'b1b2c3d4-e5f6-7890-abcd-ef1234567891';
const recId2 = 'b1b2c3d4-e5f6-7890-abcd-ef1234567892';

jest.mock('../../middlewares/auth', () => ({
  auth: (req: any, res: any, next: any) => {
    const token = req.headers?.authorization?.replace('Bearer ', '');
    if (!token || token === 'invalid') {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }
    req.user = { id: mockPatronId, email: 'patron@e2e.test', role: 'patron' };
    next();
  },
  requireDynamicPermission: () => (req: any, res: any, next: any) => next(),
  requireRole: () => (req: any, res: any, next: any) => next(),
}));

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => ({
    findUnpaidFinesByPatron: jest.fn(async (patronId: string) => {
      const records = (global as any).__e2eBorrowRecords || [];
      return records.filter((r: any) => r.patronId === patronId && !r.finePaid);
    }),
    findFineRecordsByIds: jest.fn(async (ids: string[]) => {
      const records = (global as any).__e2eBorrowRecords || [];
      return records.filter((r: any) => ids.includes(r.id));
    }),
    saveBorrowRecords: jest.fn(async (records: any[]) => {
      const db = (global as any).__e2eBorrowRecords || [];
      for (const updated of records) {
        const idx = db.findIndex((r: any) => r.id === updated.id);
        if (idx !== -1) {
          db[idx] = { ...db[idx], ...updated };
        }
      }
      return records;
    }),
    hasUnpaidFinesForPatron: jest.fn(async (patronId: string) => {
      const records = (global as any).__e2eBorrowRecords || [];
      return records.some((r: any) => r.patronId === patronId && !r.finePaid);
    }),
  })),
}));

describe('Payment & Fine Settlement E2E Lifecycle', () => {
  const secretKey = 'e2e-secret-key-123456';
  let app: Express;
  let mockOrderRepo: any;
  let paymentService: PaymentService;
  let savedOrders: Map<string, any>;
  let borrowRecordsInDb: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYOS_CHECKSUM_KEY = secretKey;
    savedOrders = new Map();

    // Initial state: Patron has 2 unpaid fine records (overdue + damage)
    borrowRecordsInDb = [
      {
        id: recId1,
        slipId: 'c1b2c3d4-e5f6-7890-abcd-ef1234567893',
        bookCopyId: 'd1b2c3d4-e5f6-7890-abcd-ef1234567894',
        patronId: mockPatronId,
        returnedAt: new Date('2026-10-01T10:00:00Z'),
        dueDate: new Date('2026-09-25T10:00:00Z'),
        fineAmount: 20000,
        damageFee: 0,
        finePaid: false,
        paymentRef: null,
        book: { title: 'Lập Trình Hướng Đối Tượng Java', code: 'IT-001' },
      },
      {
        id: recId2,
        slipId: 'c1b2c3d4-e5f6-7890-abcd-ef1234567893',
        bookCopyId: 'd1b2c3d4-e5f6-7890-abcd-ef1234567895',
        patronId: mockPatronId,
        returnedAt: new Date('2026-10-01T10:00:00Z'),
        dueDate: new Date('2026-10-05T10:00:00Z'),
        fineAmount: 0,
        damageFee: 35000,
        finePaid: false,
        paymentRef: null,
        book: { title: 'Cấu Trúc Dữ Liệu & Giải Thuật', code: 'IT-002' },
      },
    ];

    mockOrderRepo = {
      create: jest.fn((data) => ({ id: `order-${Date.now()}`, ...data })),
      save: jest.fn(async (order: any) => {
        const id = order.id || `order-${Date.now()}`;
        const saved = { ...order, id };
        savedOrders.set(order.orderCode, saved);
        return saved;
      }),
      findOne: jest.fn(async ({ where }: { where: { orderCode: string } }) => {
        return savedOrders.get(where.orderCode) || null;
      }),
    };

    (AppDataSource.getRepository as jest.Mock) = jest.fn().mockReturnValue(mockOrderRepo);

    (global as any).__e2eBorrowRecords = borrowRecordsInDb;
    paymentService = new PaymentService(new (jest.requireMock('../../repositories/BorrowRepository').BorrowRepository)());

    app = express();
    app.use(express.json());

    // Register routes
    app.use('/borrow/payments', createPaymentRouter(paymentService));
    app.use('/borrow', borrowRoutes);
    app.use(errorHandler);
  });

  it('executes full end-to-end payment lifecycle successfully', async () => {
    // -------------------------------------------------------------
    // Step 1: Patron queries their unpaid fine records
    // -------------------------------------------------------------
    const getFinesRes = await request(app)
      .get('/borrow/patron/fines')
      .set('Authorization', 'Bearer valid-patron-token');

    expect(getFinesRes.status).toBe(200);
    expect(getFinesRes.body).toHaveLength(2);
    expect(getFinesRes.body[0].overdue_fine).toBe(20000);
    expect(getFinesRes.body[1].damage_fee).toBe(35000);

    const recordIdsToPay = getFinesRes.body.map((r: any) => r.record_id);
    expect(recordIdsToPay).toEqual([recId1, recId2]);

    // -------------------------------------------------------------
    // Step 2: Patron creates a payment order (Dynamic VietQR)
    // -------------------------------------------------------------
    const createOrderRes = await request(app)
      .post('/borrow/payments/create')
      .set('Authorization', 'Bearer valid-patron-token')
      .send({
        record_ids: recordIdsToPay,
        payment_method: 'vietqr',
      });

    expect(createOrderRes.status).toBe(201);
    const orderData = createOrderRes.body;
    expect(orderData.amount).toBe(55000); // 20000 + 35000
    expect(orderData.status).toBe('pending');
    expect(orderData.orderCode).toMatch(/^TXN-/);
    expect(orderData.qrUrl).toContain('amount=55000');
    expect(orderData.qrData).toContain('vietqr://pay');

    const generatedOrderCode = orderData.orderCode;

    // -------------------------------------------------------------
    // Step 3: Polling checks payment status (Initially PENDING)
    // -------------------------------------------------------------
    const checkPendingRes = await request(app)
      .get(`/borrow/payments/${generatedOrderCode}/status`);

    expect(checkPendingRes.status).toBe(200);
    expect(checkPendingRes.body.status).toBe('pending');
    expect(checkPendingRes.body.amount).toBe(55000);
    expect(checkPendingRes.body.paidAt).toBeFalsy();

    // -------------------------------------------------------------
    // Step 4: Webhook with forged / invalid signature is REJECTED
    // -------------------------------------------------------------
    const badSigWebhookRes = await request(app)
      .post('/borrow/payments/webhook')
      .set('x-signature', 'forged-invalid-sha256')
      .send({
        orderCode: generatedOrderCode,
        amount: 55000,
      });

    expect(badSigWebhookRes.status).toBe(400);
    expect(badSigWebhookRes.body.error).toContain('Chữ ký webhook (signature) không hợp lệ');

    // -------------------------------------------------------------
    // Step 5: Webhook without required signature is REJECTED
    // -------------------------------------------------------------
    const noSigWebhookRes = await request(app)
      .post('/borrow/payments/webhook')
      .send({
        orderCode: generatedOrderCode,
        amount: 55000,
      });

    expect(noSigWebhookRes.status).toBe(400);
    expect(noSigWebhookRes.body.error).toContain('Thiếu chữ ký webhook');

    // -------------------------------------------------------------
    // Step 6: Webhook with insufficient amount is REJECTED
    // -------------------------------------------------------------
    const underpaidPayload = { orderCode: generatedOrderCode, amount: 20000 };
    const underpaidRaw = JSON.stringify(underpaidPayload);
    const underpaidSig = crypto.createHmac('sha256', secretKey).update(underpaidRaw).digest('hex');

    const underpaidRes = await request(app)
      .post('/borrow/payments/webhook')
      .set('x-signature', underpaidSig)
      .send(underpaidPayload);

    expect(underpaidRes.status).toBe(400);
    expect(underpaidRes.body.error).toContain('không đủ cho đơn');

    // -------------------------------------------------------------
    // Step 7: Authentic Bank/PayOS Webhook arrives with VALID HMAC signature
    // -------------------------------------------------------------
    const validPayload = {
      orderCode: generatedOrderCode,
      amount: 55000,
      gatewayTransId: 'MB-NAPAS-889977',
    };
    const validRaw = JSON.stringify(validPayload);
    const validSignature = crypto.createHmac('sha256', secretKey).update(validRaw).digest('hex');

    const webhookRes = await request(app)
      .post('/borrow/payments/webhook')
      .set('x-signature', validSignature)
      .send(validPayload);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.success).toBe(true);
    expect(webhookRes.body.orderCode).toBe(generatedOrderCode);
    expect(webhookRes.body.alreadyCompleted).toBe(false);
    expect(webhookRes.body.activatedPatrons).toContain(mockPatronId);

    // Verify DB state: Records settled
    expect(borrowRecordsInDb[0].finePaid).toBe(true);
    expect(borrowRecordsInDb[0].paymentRef).toBe(generatedOrderCode);
    expect(borrowRecordsInDb[1].finePaid).toBe(true);
    expect(borrowRecordsInDb[1].paymentRef).toBe(generatedOrderCode);

    // Verify User Service called to auto-activate card
    expect(userServiceClient.activateCardAutoFine).toHaveBeenCalledWith(mockPatronId);

    // Verify payment.completed domain event dispatched
    expect(eventPublisher.publishEvent).toHaveBeenCalledWith(
      'payment.completed',
      expect.objectContaining({
        orderCode: generatedOrderCode,
        patronId: mockPatronId,
        amount: 55000,
      }),
    );

    // -------------------------------------------------------------
    // Step 8: Polling verifies order is COMPLETED with paidAt timestamp
    // -------------------------------------------------------------
    const checkCompletedRes = await request(app)
      .get(`/borrow/payments/${generatedOrderCode}/status`);

    expect(checkCompletedRes.status).toBe(200);
    expect(checkCompletedRes.body.status).toBe('completed');
    expect(checkCompletedRes.body.paidAt).not.toBeNull();

    // -------------------------------------------------------------
    // Step 9: Replay / duplicate webhook is IDEMPOTENT (no double processing)
    // -------------------------------------------------------------
    const duplicateRes = await request(app)
      .post('/borrow/payments/webhook')
      .set('x-signature', validSignature)
      .send(validPayload);

    expect(duplicateRes.status).toBe(200);
    expect(duplicateRes.body.alreadyCompleted).toBe(true);

    // -------------------------------------------------------------
    // Step 10: Patron queries fines again -> 0 unpaid fines remaining!
    // -------------------------------------------------------------
    const getFinesAfterRes = await request(app)
      .get('/borrow/patron/fines')
      .set('Authorization', 'Bearer valid-patron-token');

    expect(getFinesAfterRes.status).toBe(200);
    expect(getFinesAfterRes.body).toHaveLength(0);
  });
});
