import crypto from 'crypto';
import { AppDataSource } from '../data-source';
import { PaymentOrder, PaymentOrderStatus, PaymentMethodType } from '../entities/PaymentOrder';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { activateCardAutoFine } from '../clients/UserServiceClient';
import { publishEvent } from '../utils/eventPublisher';
import { generatePaymentRef } from '../utils/fineCalculator';
import { HttpError } from '../middlewares/errorHandler';

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
  bankCode = process.env.VIETQR_BANK_CODE || 'ICB',
  accountNumber = process.env.VIETQR_ACCOUNT_NUMBER || '1133669988',
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
    const { qrUrl, qrData } = generateVietQrData(orderCode, totalAmount);

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

    const now = new Date();
    order.status = 'completed';
    order.paidAt = now;
    order.gatewayTransId = payload?.data?.reference || payload?.gatewayTransId || payload?.data?.paymentLinkId || null;
    order.webhookPayload = payload;
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
