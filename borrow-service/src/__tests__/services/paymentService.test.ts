import crypto from 'crypto';
import { PaymentService, generateVietQrData, generateSepayQrData, verifyHmacSignature } from '../../services/PaymentService';
import { AppDataSource } from '../../data-source';
import * as eventPublisher from '../../utils/eventPublisher';
import * as userServiceClient from '../../clients/UserServiceClient';

jest.mock('../../data-source');
jest.mock('../../utils/eventPublisher');
jest.mock('../../clients/UserServiceClient');

describe('PaymentService', () => {
  const secretKey = 'test-secret-key';
  let paymentService: PaymentService;
  let mockRepo: any;
  let mockOrderRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYOS_CHECKSUM_KEY = secretKey;

    mockRepo = {
      findFineRecordsByIds: jest.fn(),
      saveBorrowRecords: jest.fn(),
      hasUnpaidFinesForPatron: jest.fn(),
    };

    mockOrderRepo = {
      create: jest.fn((data) => ({ id: 'order-uuid-1', ...data })),
      save: jest.fn(async (order) => ({ ...order, id: order.id || 'order-uuid-1' })),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    (AppDataSource.getRepository as jest.Mock) = jest.fn().mockReturnValue(mockOrderRepo);

    paymentService = new PaymentService(mockRepo);
  });

  describe('generateVietQrData', () => {
    it('creates standardized VietQR URL and deep link with orderCode and amount', () => {
      const { qrUrl, qrData } = generateVietQrData('TXN-20261005-12345678', 50000, 'ICB', '99998888', 'THU VIEN IUH');
      expect(qrUrl).toContain('https://img.vietqr.io/image/ICB-99998888-compact2.png');
      expect(qrUrl).toContain('amount=50000');
      expect(qrUrl).toContain('addInfo=TXN-20261005-12345678');
      expect(qrData).toContain('vietqr://pay?bank=ICB&acc=99998888&amount=50000');
    });
  });

  describe('verifyHmacSignature', () => {
    it('verifies valid HMAC-SHA256 signature', () => {
      const payload = { code: '00', desc: 'success' };
      const raw = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secretKey).update(raw).digest('hex');

      expect(verifyHmacSignature(payload, signature, secretKey)).toBe(true);
      expect(verifyHmacSignature(payload, 'invalid-signature', secretKey)).toBe(false);
    });
  });

  describe('createPaymentOrder', () => {
    it('validates and creates payment order for unpaid fine records', async () => {
      const mockRecords = [
        { id: 'rec-1', patronId: 'patron-1', fineAmount: 10000, damageFee: 5000, finePaid: false },
        { id: 'rec-2', patronId: 'patron-1', fineAmount: 20000, damageFee: 0, finePaid: false },
      ];
      mockRepo.findFineRecordsByIds.mockResolvedValue(mockRecords);

      const result = await paymentService.createPaymentOrder('patron-1', ['rec-1', 'rec-2'], 'vietqr');

      expect(result.amount).toBe(35000);
      expect(result.status).toBe('pending');
      expect(result.orderCode).toMatch(/^TXN-/);
      expect(result.qrUrl).toContain('amount=35000');
      expect(mockOrderRepo.save).toHaveBeenCalled();
    });

    it('rejects if a record belongs to another patron', async () => {
      mockRepo.findFineRecordsByIds.mockResolvedValue([
        { id: 'rec-1', patronId: 'other-patron', fineAmount: 10000, damageFee: 0, finePaid: false },
      ]);

      await expect(
        paymentService.createPaymentOrder('patron-1', ['rec-1']),
      ).rejects.toThrow('Bản ghi không thuộc về độc giả yêu cầu');
    });

    it('rejects if a record is already paid', async () => {
      mockRepo.findFineRecordsByIds.mockResolvedValue([
        { id: 'rec-1', patronId: 'patron-1', fineAmount: 10000, damageFee: 0, finePaid: true },
      ]);

      await expect(
        paymentService.createPaymentOrder('patron-1', ['rec-1']),
      ).rejects.toThrow('đã được thanh toán');
    });

    it('rejects if total debt amount is zero', async () => {
      mockRepo.findFineRecordsByIds.mockResolvedValue([
        { id: 'rec-1', patronId: 'patron-1', fineAmount: 0, damageFee: 0, finePaid: false },
      ]);

      await expect(
        paymentService.createPaymentOrder('patron-1', ['rec-1']),
      ).rejects.toThrow('Tổng số tiền phạt và bồi thường bằng 0');
    });
  });

  describe('getOrderStatus', () => {
    it('returns current order status', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        orderCode: 'TXN-001',
        status: 'pending',
        amount: 25000,
        paymentMethod: 'vietqr',
        paidAt: null,
        expiresAt: new Date(Date.now() + 100000),
        recordIds: ['rec-1'],
      });

      const status = await paymentService.getOrderStatus('TXN-001');
      expect(status.status).toBe('pending');
      expect(status.amount).toBe(25000);
    });

    it('automatically transitions to expired if past expiration date', async () => {
      const expiredOrder = {
        orderCode: 'TXN-002',
        status: 'pending',
        amount: 25000,
        paymentMethod: 'vietqr',
        paidAt: null,
        expiresAt: new Date(Date.now() - 1000),
        recordIds: ['rec-1'],
      };
      mockOrderRepo.findOne.mockResolvedValue(expiredOrder);

      const status = await paymentService.getOrderStatus('TXN-002');
      expect(status.status).toBe('expired');
      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    });
  });

  describe('processWebhook', () => {
    it('processes valid webhook, settles debt, auto-activates card, and publishes event', async () => {
      const order = {
        id: 'order-1',
        orderCode: 'TXN-20261005-TEST',
        patronId: 'patron-1',
        amount: 50000,
        status: 'pending',
        paymentMethod: 'vietqr',
        recordIds: ['rec-1'],
      };
      mockOrderRepo.findOne.mockResolvedValue(order);

      const mockRecords = [
        { id: 'rec-1', patronId: 'patron-1', fineAmount: 50000, damageFee: 0, finePaid: false },
      ];
      mockRepo.findFineRecordsByIds.mockResolvedValue(mockRecords);
      mockRepo.hasUnpaidFinesForPatron.mockResolvedValue(false); // No more debt!

      const payload = {
        orderCode: 'TXN-20261005-TEST',
        amount: 50000,
        gatewayTransId: 'GATEWAY-123456',
      };
      const raw = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secretKey).update(raw).digest('hex');

      const result = await paymentService.processWebhook(payload, signature);

      expect(result.success).toBe(true);
      expect(result.alreadyCompleted).toBe(false);
      expect(result.activatedPatrons).toContain('patron-1');

      // Verify order marked completed
      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
        gatewayTransId: 'GATEWAY-123456',
      }));

      // Verify borrow records settled
      expect(mockRecords[0].finePaid).toBe(true);
      expect(mockRecords[0].paymentRef).toBe('TXN-20261005-TEST');
      expect(mockRepo.saveBorrowRecords).toHaveBeenCalledWith(mockRecords);

      // Verify user service auto activation called
      expect(userServiceClient.activateCardAutoFine).toHaveBeenCalledWith('patron-1');

      // Verify event published
      expect(eventPublisher.publishEvent).toHaveBeenCalledWith('payment.completed', expect.objectContaining({
        orderCode: 'TXN-20261005-TEST',
        amount: 50000,
      }));
    });

    it('is idempotent when order is already completed', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        orderCode: 'TXN-ALREADY-DONE',
        status: 'completed',
      });

      const payload = { orderCode: 'TXN-ALREADY-DONE', amount: 50000 };
      const raw = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secretKey).update(raw).digest('hex');

      const result = await paymentService.processWebhook(payload, signature);
      expect(result.alreadyCompleted).toBe(true);
      expect(mockRepo.saveBorrowRecords).not.toHaveBeenCalled();
    });

    it('rejects if signature verification fails', async () => {
      const payload = { orderCode: 'TXN-123' };
      await expect(
        paymentService.processWebhook(payload, 'bad-signature'),
      ).rejects.toThrow('Chữ ký webhook (signature) không hợp lệ');
    });

    it('rejects if secretKey is configured but signature is omitted', async () => {
      const payload = { orderCode: 'TXN-123' };
      await expect(
        paymentService.processWebhook(payload, undefined),
      ).rejects.toThrow('Thiếu chữ ký webhook (signature)');
    });

    it('accepts signature embedded directly inside payload.signature', async () => {
      const order = {
        id: 'order-1',
        orderCode: 'TXN-BODY-SIG',
        patronId: 'patron-1',
        amount: 20000,
        status: 'pending',
        paymentMethod: 'vietqr',
        recordIds: ['rec-1'],
      };
      mockOrderRepo.findOne.mockResolvedValue(order);
      mockRepo.findFineRecordsByIds.mockResolvedValue([
        { id: 'rec-1', patronId: 'patron-1', fineAmount: 20000, damageFee: 0, finePaid: false },
      ]);
      mockRepo.hasUnpaidFinesForPatron.mockResolvedValue(true);

      const basePayload = { orderCode: 'TXN-BODY-SIG', amount: 20000 };
      const raw = JSON.stringify(basePayload);
      const signature = crypto.createHmac('sha256', secretKey).update(raw).digest('hex');
      const payloadWithSig = { ...basePayload, signature };

      const result = await paymentService.processWebhook(payloadWithSig);
      expect(result.success).toBe(true);
      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    });

    it('rejects if paid amount is less than order amount', async () => {
      const order = {
        id: 'order-1',
        orderCode: 'TXN-UNDERPAID',
        patronId: 'patron-1',
        amount: 50000,
        status: 'pending',
        recordIds: ['rec-1'],
      };
      mockOrderRepo.findOne.mockResolvedValue(order);

      const payload = { orderCode: 'TXN-UNDERPAID', amount: 30000 };
      const raw = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secretKey).update(raw).digest('hex');

      await expect(
        paymentService.processWebhook(payload, signature),
      ).rejects.toThrow('không đủ cho đơn');
    });

    it('throws 404 if orderCode in webhook does not exist', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null);
      const payload = { orderCode: 'TXN-NOT-FOUND', amount: 50000 };
      const raw = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secretKey).update(raw).digest('hex');

      await expect(
        paymentService.processWebhook(payload, signature),
      ).rejects.toThrow('Không tìm thấy đơn hàng tương ứng');
    });
  });

  describe('confirmManualReceipt (staff reconciliation)', () => {
    it('confirms a pending order and settles debt like a webhook', async () => {
      const order = {
        id: 'order-1',
        orderCode: 'TXN-MANUAL-1',
        patronId: 'patron-1',
        amount: 50000,
        status: 'pending',
        paymentMethod: 'vietqr',
        recordIds: ['rec-1'],
      };
      mockOrderRepo.findOne.mockResolvedValue(order);
      mockRepo.findFineRecordsByIds.mockResolvedValue([
        { id: 'rec-1', patronId: 'patron-1', fineAmount: 50000, damageFee: 0, finePaid: false },
      ]);
      mockRepo.hasUnpaidFinesForPatron.mockResolvedValue(false);

      const result = await paymentService.confirmManualReceipt('TXN-MANUAL-1', 'staff-1', 'Đã thấy trên sao kê MB');

      expect(result.success).toBe(true);
      expect(result.alreadyCompleted).toBe(false);
      expect(result.activatedPatrons).toContain('patron-1');
      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
        gatewayTransId: 'MANUAL:staff-1',
      }));
      expect(userServiceClient.activateCardAutoFine).toHaveBeenCalledWith('patron-1');
      expect(eventPublisher.publishEvent).toHaveBeenCalledWith('payment.completed', expect.objectContaining({
        orderCode: 'TXN-MANUAL-1',
      }));
    });

    it('accepts expired orders because transfers often arrive late', async () => {
      const order = {
        id: 'order-2',
        orderCode: 'TXN-MANUAL-2',
        patronId: 'patron-1',
        amount: 30000,
        status: 'expired',
        paymentMethod: 'vietqr',
        recordIds: ['rec-2'],
      };
      mockOrderRepo.findOne.mockResolvedValue(order);
      mockRepo.findFineRecordsByIds.mockResolvedValue([
        { id: 'rec-2', patronId: 'patron-1', fineAmount: 30000, damageFee: 0, finePaid: false },
      ]);
      mockRepo.hasUnpaidFinesForPatron.mockResolvedValue(true);

      const result = await paymentService.confirmManualReceipt('TXN-MANUAL-2', 'staff-1');

      expect(result.success).toBe(true);
      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    });

    it('is idempotent when order is already completed', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'order-3',
        orderCode: 'TXN-DONE',
        status: 'completed',
      });

      const result = await paymentService.confirmManualReceipt('TXN-DONE', 'staff-1');
      expect(result.alreadyCompleted).toBe(true);
      expect(mockRepo.saveBorrowRecords).not.toHaveBeenCalled();
    });

    it('throws 404 if order does not exist', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null);
      await expect(
        paymentService.confirmManualReceipt('TXN-MISSING', 'staff-1'),
      ).rejects.toThrow('Không tìm thấy đơn hàng tương ứng');
    });
  });

  describe('listReconcilableOrders', () => {
    it('returns pending + expired orders and transitions overdue pending to expired', async () => {
      const overdue = {
        orderCode: 'TXN-OLD',
        patronId: 'patron-1',
        amount: 50000,
        status: 'pending',
        paymentMethod: 'vietqr',
        recordIds: ['rec-1'],
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
      };
      mockOrderRepo.find = jest.fn().mockResolvedValue([overdue]);

      const rows = await paymentService.listReconcilableOrders(50);

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('expired');
      expect(mockOrderRepo.save).toHaveBeenCalledWith([expect.objectContaining({ status: 'expired' })]);
    });
  });
});
