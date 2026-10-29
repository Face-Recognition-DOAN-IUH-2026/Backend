import crypto from 'crypto';
import { AppDataSource } from '../data-source';
import { PaymentOrder, PaymentOrderStatus, PaymentMethodType } from '../entities/PaymentOrder';
import { VietqrCallback } from '../entities/VietqrCallback';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { activateCardAutoFine } from '../clients/UserServiceClient';
import { publishEvent } from '../utils/eventPublisher';
import { generatePaymentRef } from '../utils/fineCalculator';
import { HttpError } from '../../../shared/error-handler';
import { VietqrClient, generateVietqrOrderId } from './VietqrClient';

export interface CreatePaymentOrderResult {
  id: string;
  orderCode: string;
  patronId: string;
  amount: number;
  status: PaymentOrderStatus;
  paymentMethod: PaymentMethodType;
  qrUrl: string | null;
  qrData: string | null;
  expiresAt: Date;
  recordIds: string[];
}

export function generateVietQrData(
  orderCode: string,
  amount: number,
  bankCode = process.env.VIETQR_BANK_CODE || 'MB',
  accountNumber = process.env.VIETQR_ACCOUNT_NUMBER || '0395324779',
  accountName = process.env.VIETQR_ACCOUNT_NAME || 'THU VIEN DAI HOC CONG NGHIEP TPHCM',
): { qrUrl: string; qrData: string } {
  const qrUrl = `https://img.vietqr.io/image/${bankCode}-${accountNumber}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(orderCode)}&accountName=${encodeURIComponent(accountName)}`;
  const qrData = `vietqr://pay?bank=${bankCode}&acc=${accountNumber}&amount=${amount}&msg=${encodeURIComponent(orderCode)}`;
  return { qrUrl, qrData };
}

export function verifyHmacSignature(payload: any, signature: string, secretKey: string): boolean {
  try {
    const checkAgainst = (data: any) => {
      const rawData = typeof data === 'string' ? data : JSON.stringify(data);
      const expected = crypto.createHmac('sha256', secretKey).update(rawData).digest('hex');
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    };

    if (checkAgainst(payload)) return true;

    // If payload has signature field stripped
    if (typeof payload === 'object' && payload !== null && 'signature' in payload) {
      const { signature: _sig, ...rest } = payload;
      if (checkAgainst(rest)) return true;
      if (payload.data && checkAgainst(payload.data)) return true;
    }

    return false;
  } catch {
    return false;
  }
}

export class PaymentService {
  private repo: BorrowRepository;

  constructor(repo?: BorrowRepository) {
    this.repo = repo || new BorrowRepository();
  }

  private get orderRepo() {
    return AppDataSource.getRepository(PaymentOrder);
  }

  private get callbackRepo() {
    return AppDataSource.getRepository(VietqrCallback);
  }

  async createPaymentOrder(
    patronId: string,
    recordIds: string[],
    paymentMethod: PaymentMethodType = 'vietqr',
  ): Promise<CreatePaymentOrderResult> {
    if (!recordIds || recordIds.length === 0) {
      throw new HttpError(400, 'Danh sách record_ids không được để trống');
    }

    const records = await this.repo.findFineRecordsByIds(recordIds);
    const missing = recordIds.filter((id) => !records.some((r) => r.id === id));
    if (missing.length > 0) {
      throw new HttpError(404, `Không tìm thấy bản ghi mượn: ${missing[0]}`);
    }

    // Check if any record belongs to another patron
    const foreignRecord = records.find((r) => r.patronId !== patronId);
    if (foreignRecord) {
      throw new HttpError(403, 'Bản ghi không thuộc về độc giả yêu cầu');
    }

    // Check if any record is already paid
    const alreadyPaid = records.find((r) => r.finePaid);
    if (alreadyPaid) {
      throw new HttpError(400, `Bản ghi ${alreadyPaid.id} đã được thanh toán`);
    }

    // Compute total debt
    let totalAmount = 0;
    for (const r of records) {
      totalAmount += (Number(r.fineAmount) || 0) + (Number(r.damageFee) || 0);
    }

    if (totalAmount <= 0) {
      throw new HttpError(400, 'Tổng số tiền phạt và bồi thường bằng 0, không cần thanh toán');
    }

    const orderCode = generatePaymentRef();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins timeout

    // Prefer VietQR dynamic QR (carries a ≤13-char orderId so the automatic
    // transaction-sync callback can match the order exactly). Fall back to the
    // static img.vietqr.io QR when the VietQR API is not configured/fails.
    let qrUrl: string | null = null;
    let qrData: string | null = null;
    let vietqrOrderId: string | null = null;
    let vietqrQrLink: string | null = null;
    const vietqr = new VietqrClient();
    if (vietqr.isEnabled()) {
      try {
        vietqrOrderId = generateVietqrOrderId();
        const dynamic = await vietqr.generateDynamicQr({
          orderId: vietqrOrderId,
          content: vietqrOrderId,
          amount: totalAmount,
        });
        // qrLink is a VietQR landing page (not an embeddable image), so the
        // frontend renders the EMV string itself via QRCodeSVG.
        qrUrl = null;
        qrData = dynamic.qrCode;
        vietqrQrLink = dynamic.qrLink || null;
      } catch (err: any) {
        console.warn('[createPaymentOrder] VietQR dynamic QR failed, fallback to static QR:', err?.message);
        vietqrOrderId = null;
      }
    }
    if (vietqrOrderId === null) {
      const staticQr = generateVietQrData(orderCode, totalAmount);
      qrUrl = staticQr.qrUrl;
      qrData = staticQr.qrData;
    }

    const order = this.orderRepo.create({
      orderCode,
      patronId,
      amount: totalAmount,
      status: 'pending',
      paymentMethod,
      qrUrl,
      qrData,
      recordIds,
      expiresAt,
      vietqrOrderId,
      vietqrQrLink,
    });

    const saved = await this.orderRepo.save(order);

    return {
      id: saved.id,
      orderCode: saved.orderCode,
      patronId: saved.patronId,
      amount: Number(saved.amount),
      status: saved.status,
      paymentMethod: saved.paymentMethod,
      qrUrl: saved.qrUrl,
      qrData: saved.qrData,
      expiresAt: saved.expiresAt,
      recordIds: saved.recordIds,
    };
  }

  async getOrderStatus(orderCode: string): Promise<{
    orderCode: string;
    status: PaymentOrderStatus;
    amount: number;
    paymentMethod: PaymentMethodType;
    paidAt: Date | null;
    expiresAt: Date;
    recordIds: string[];
  }> {
    const order = await this.orderRepo.findOne({ where: { orderCode } });
    if (!order) {
      throw new HttpError(404, `Không tìm thấy đơn thanh toán với mã: ${orderCode}`);
    }

    // Auto-expire if pending and past expiration time
    if (order.status === 'pending' && new Date() > order.expiresAt) {
      order.status = 'expired';
      await this.orderRepo.save(order);
    }

    return {
      orderCode: order.orderCode,
      status: order.status,
      amount: Number(order.amount),
      paymentMethod: order.paymentMethod,
      paidAt: order.paidAt,
      expiresAt: order.expiresAt,
      recordIds: order.recordIds,
    };
  }

  async processWebhook(
    payload: any,
    signatureHeader?: string,
  ): Promise<{ success: boolean; orderCode: string; alreadyCompleted: boolean; activatedPatrons: string[] }> {
    const secretKey = process.env.PAYOS_CHECKSUM_KEY || process.env.PAYMENT_WEBHOOK_SECRET;
    const signature = signatureHeader || payload?.signature;
    if (secretKey) {
      if (!signature) {
        throw new HttpError(400, 'Thiếu chữ ký webhook (signature)');
      }
      const valid = verifyHmacSignature(payload, signature, secretKey);
      if (!valid) {
        throw new HttpError(400, 'Chữ ký webhook (signature) không hợp lệ');
      }
    }

    // Support PayOS / VietQR payload structures
    const orderCode = payload?.data?.description || payload?.orderCode || payload?.data?.orderCode;
    if (!orderCode) {
      throw new HttpError(400, 'Thiếu thông tin mã đơn hàng orderCode trong webhook');
    }

    const order = await this.orderRepo.findOne({ where: { orderCode } });
    if (!order) {
      throw new HttpError(404, `Không tìm thấy đơn hàng tương ứng với orderCode: ${orderCode}`);
    }

    if (order.status === 'completed') {
      return { success: true, orderCode: order.orderCode, alreadyCompleted: true, activatedPatrons: [] };
    }

    const paidAmount = Number(payload?.data?.amount ?? payload?.amount ?? order.amount);
    if (paidAmount < Number(order.amount)) {
      throw new HttpError(400, `Số tiền thanh toán (${paidAmount}) không đủ cho đơn (${order.amount})`);
    }

    const gatewayTransId = payload?.data?.reference || payload?.gatewayTransId || payload?.data?.paymentLinkId || null;
    return this.settleCompletedOrder(order, gatewayTransId, payload);
  }

  /**
   * Staff manual reconciliation: confirm that money for an order has actually
   * arrived in the bank account (checked against the bank statement), then
   * settle the debt exactly like a webhook would.
   * Accepts `pending` AND `expired` orders because transfers often arrive
   * after the 15-minute QR window.
   */
  async confirmManualReceipt(
    orderCode: string,
    confirmedBy: string,
    note?: string,
  ): Promise<{ success: boolean; orderCode: string; alreadyCompleted: boolean; activatedPatrons: string[] }> {
    const order = await this.orderRepo.findOne({ where: { orderCode } });
    if (!order) {
      throw new HttpError(404, `Không tìm thấy đơn hàng tương ứng với orderCode: ${orderCode}`);
    }

    if (order.status === 'completed') {
      return { success: true, orderCode: order.orderCode, alreadyCompleted: true, activatedPatrons: [] };
    }

    if (order.status !== 'pending' && order.status !== 'expired') {
      throw new HttpError(400, `Đơn ${orderCode} ở trạng thái ${order.status}, không thể xác nhận thu tiền`);
    }

    return this.settleCompletedOrder(order, `MANUAL:${confirmedBy}`, {
      manualConfirm: { by: confirmedBy, at: new Date().toISOString(), note: note || null },
    });
  }

  /**
   * List orders awaiting reconciliation (pending + expired), newest first.
   * Pending orders past their expiry are transitioned to expired on read.
   */
  async listReconcilableOrders(limit = 50): Promise<Array<{
    orderCode: string;
    patronId: string;
    amount: number;
    status: PaymentOrderStatus;
    paymentMethod: PaymentMethodType;
    recordIds: string[];
    expiresAt: Date;
    createdAt: Date;
  }>> {
    const orders = await this.orderRepo.find({
      where: [{ status: 'pending' }, { status: 'expired' }],
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    const now = new Date();
    const touched: PaymentOrder[] = [];
    for (const order of orders) {
      if (order.status === 'pending' && now > order.expiresAt) {
        order.status = 'expired';
        touched.push(order);
      }
    }
    if (touched.length > 0) {
      await this.orderRepo.save(touched);
    }

    return orders.map((order) => ({
      orderCode: order.orderCode,
      patronId: order.patronId,
      amount: Number(order.amount),
      status: order.status,
      paymentMethod: order.paymentMethod,
      recordIds: order.recordIds,
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
    }));
  }

  /**
   * Settle a VietQR transaction-sync callback (automatic bank reconciliation).
   * Matching priority: VietQR orderId -> exact content (= our VietQR order id)
   * -> legacy content containing our internal orderCode (static-QR fallback).
   * Failed validations throw so VietQR retries the callback later.
   */
  async processVietqrCallback(input: {
    transactionid: string;
    referencenumber?: string;
    bankaccount?: string;
    amount: number | string;
    transType?: string;
    content?: string;
    orderId?: string;
  }): Promise<{ orderCode: string; duplicate: boolean }> {
    const { transactionid, referencenumber, bankaccount, amount, transType, content, orderId } = input;
    if (!transactionid) {
      throw new HttpError(400, 'Thiếu transactionid trong callback VietQR');
    }

    const existing = await this.callbackRepo.findOne({ where: { transactionId: transactionid } });
    if (existing) {
      return { orderCode: existing.orderCode ?? '', duplicate: true };
    }

    if (transType && transType !== 'C') {
      throw new HttpError(400, `Giao dịch ${transType} không phải khoản thu (ghi có), bỏ qua`);
    }

    const expectedAccount = process.env.VIETQR_ACCOUNT_NUMBER;
    if (expectedAccount && bankaccount && bankaccount !== expectedAccount) {
      throw new HttpError(400, `TK nhận ${bankaccount} không khớp TK thư viện`);
    }

    let order = null;
    if (orderId) {
      order = await this.orderRepo.findOne({ where: { vietqrOrderId: orderId } });
    }
    if (!order && content) {
      order = await this.orderRepo.findOne({ where: { vietqrOrderId: content } });
    }
    if (!order && content) {
      const candidates = await this.orderRepo.find({
        where: [{ status: 'pending' }, { status: 'expired' }],
        order: { createdAt: 'DESC' },
        take: 100,
      });
      order = candidates.find((o) => content.includes(o.orderCode)) ?? null;
    }
    if (!order) {
      throw new HttpError(404, `Không tìm thấy đơn hàng cho callback VietQR (orderId=${orderId ?? ''})`);
    }

    if (order.status === 'completed') {
      await this.recordVietqrCallback(transactionid, order.orderCode, amount, input);
      return { orderCode: order.orderCode, duplicate: true };
    }

    if (Number(amount) < Number(order.amount)) {
      throw new HttpError(400, `Số tiền ${amount} không đủ cho đơn ${order.amount} (${order.orderCode})`);
    }

    await this.settleCompletedOrder(order, referencenumber || transactionid, { vietqrCallback: input });
    await this.recordVietqrCallback(transactionid, order.orderCode, amount, input);
    return { orderCode: order.orderCode, duplicate: false };
  }

  private async recordVietqrCallback(
    transactionId: string,
    orderCode: string,
    amount: number | string,
    payload: Record<string, any>,
  ): Promise<void> {
    try {
      await this.callbackRepo.save(this.callbackRepo.create({
        transactionId,
        orderCode,
        amount: Number(amount) || 0,
        payload,
      }));
    } catch (err: any) {
      // Best-effort audit row: duplicate inserts (23505) just mean a retried callback.
      console.warn('[processVietqrCallback] callback audit row skipped:', err?.message);
    }
  }

  private async settleCompletedOrder(    order: PaymentOrder,
    gatewayTransId: string | null,
    receiptPayload: Record<string, any>,
  ): Promise<{ success: boolean; orderCode: string; alreadyCompleted: boolean; activatedPatrons: string[] }> {
    const now = new Date();
    order.status = 'completed';
    order.paidAt = now;
    order.gatewayTransId = gatewayTransId;
    order.webhookPayload = receiptPayload;
    await this.orderRepo.save(order);

    // Settle borrow records
    const records = await this.repo.findFineRecordsByIds(order.recordIds);
    for (const r of records) {
      r.finePaid = true;
      r.paymentMethod = order.paymentMethod;
      r.paymentRef = order.orderCode;
      r.paidAt = now;
    }
    await this.repo.saveBorrowRecords(records);

    // Auto-unlock card if patron has 0 remaining debt
    const activatedPatrons: string[] = [];
    try {
      const hasDebt = await this.repo.hasUnpaidFinesForPatron(order.patronId);
      if (!hasDebt) {
        await activateCardAutoFine(order.patronId);
        activatedPatrons.push(order.patronId);
      }
    } catch (err: any) {
      console.warn('[processWebhook] card auto-activate best-effort failed:', err?.message);
    }

    publishEvent('payment.completed', {
      orderCode: order.orderCode,
      patronId: order.patronId,
      amount: Number(order.amount),
      recordIds: order.recordIds,
      paidAt: now,
    });

    return {
      success: true,
      orderCode: order.orderCode,
      alreadyCompleted: false,
      activatedPatrons,
    };
  }
}
