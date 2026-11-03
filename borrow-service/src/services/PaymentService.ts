import crypto from 'crypto';
import { AppDataSource } from '../data-source';
import { PaymentOrder, PaymentOrderStatus, PaymentMethodType } from '../entities/PaymentOrder';
import { VietqrCallback } from '../entities/VietqrCallback';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { BorrowRecord } from '../entities/BorrowRecord';
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

/**
 * BLF-PAY-01 — statuses that mean the order will never settle again.
 * Settlement must short-circuit on these instead of re-applying the payment.
 */
export const TERMINAL_ORDER_STATUSES: PaymentOrderStatus[] = [
  'completed',
  'reconcile_needed',
  'refunded',
  'cancelled',
];

export function isTerminalOrderStatus(status: PaymentOrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export type ReconcileReason =
  | 'all_records_already_paid'
  | 'partial_already_paid'
  /** A second bank transfer arrived for an order that had already settled. */
  | 'duplicate_transfer_after_settlement'
  /** Money arrived but the order's fine records no longer exist. */
  | 'records_missing';

export interface ReconcileSummary {
  reason: ReconcileReason;
  amount: number;
  alreadyPaidRecordIds: string[];
  settledRecordIds: string[];
}

export interface SettlementResult {
  success: boolean;
  orderCode: string;
  alreadyCompleted: boolean;
  activatedPatrons: string[];
  reconcile?: ReconcileSummary;
}

/**
 * Split the records referenced by an order into the ones this payment may
 * settle and the ones that were already settled elsewhere (counter cash,
 * another gateway). Splitting — instead of blindly overwriting — is what makes
 * settlement non-destructive.
 */
export function partitionSettlementRecords<T extends { finePaid: boolean }>(
  records: T[],
): { settleable: T[]; alreadyPaid: T[] } {
  const settleable: T[] = [];
  const alreadyPaid: T[] = [];
  for (const record of records) {
    (record.finePaid ? alreadyPaid : settleable).push(record);
  }
  return { settleable, alreadyPaid };
}

export function sumRecordAmount(
  records: Array<{ fineAmount?: number | string | null; damageFee?: number | string | null }>,
): number {
  return records.reduce(
    (total, record) =>
      total + (Number(record.fineAmount) || 0) + (Number(record.damageFee) || 0),
    0,
  );
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
    reconcile?: {
      reason: string | null;
      amount: number;
      requiresStaffAction: boolean;
    };
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
      ...(order.status === 'reconcile_needed'
        ? {
            reconcile: {
              reason: order.reconcileReason ?? null,
              amount: Number(order.reconcileAmount) || 0,
              requiresStaffAction: true,
            },
          }
        : {}),
    };
  }

  async processWebhook(
    payload: any,
    signatureHeader?: string,
  ): Promise<SettlementResult> {
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

    if (isTerminalOrderStatus(order.status)) {
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
  ): Promise<SettlementResult> {
    const order = await this.orderRepo.findOne({ where: { orderCode } });
    if (!order) {
      throw new HttpError(404, `Không tìm thấy đơn hàng tương ứng với orderCode: ${orderCode}`);
    }

    if (
      order.status === 'completed' ||
      order.status === 'reconcile_needed' ||
      order.status === 'refunded'
    ) {
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
      // No status filter on purpose: a static-QR order has no vietqrOrderId, so
      // this content match is its only lookup path. Filtering to pending/expired
      // made every retry for an already-settled order fall through to a 404 that
      // the bank keeps retrying forever.
      const candidates = await this.orderRepo.find({
        order: { createdAt: 'DESC' },
        take: 100,
      });
      order = candidates.find((o) => content.includes(o.orderCode)) ?? null;
    }
    if (!order) {
      throw new HttpError(404, `Không tìm thấy đơn hàng cho callback VietQR (orderId=${orderId ?? ''})`);
    }

    if (isTerminalOrderStatus(order.status)) {
      await this.recordVietqrCallback(transactionid, order.orderCode, amount, input);
      // A transfer that arrives after the order settled is money the library
      // holds but has not accounted for: raise it on the reconcile queue
      // instead of answering "duplicate" and silently keeping it.
      if (order.status !== 'refunded') {
        publishEvent('payment.reconcile_needed', {
          orderCode: order.orderCode,
          patronId: order.patronId,
          amount: Number(amount) || 0,
          reason: 'duplicate_transfer_after_settlement',
          alreadyPaidRecordIds: order.recordIds ?? [],
          source: 'vietqr_callback',
        });
      }
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
      // A duplicate insert (23505) just means a retried callback. Anything else
      // is a real write failure on money that has already been applied, so it
      // must be loud enough to find in the logs.
      if (err?.code === '23505') {
        console.warn('[processVietqrCallback] duplicate callback audit row skipped:', transactionId);
        return;
      }
      console.error(
        '[processVietqrCallback] failed to store callback audit row:',
        transactionId,
        err?.message,
      );
    }
  }

  /**
   * List orders that need manual reconciliation (default: `reconcile_needed`).
   * Newest first, paginated so the staff dashboard never pulls an unbounded set.
   */
  async listReconcileOrders(params: {
    status?: PaymentOrderStatus;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{
    items: Array<{
      orderCode: string;
      patronId: string;
      amount: number;
      status: PaymentOrderStatus;
      paymentMethod: PaymentMethodType;
      recordIds: string[];
      reconcileReason: string | null;
      reconcileAmount: number | null;
      alreadyPaidRecordIds: string[];
      settledRecordIds: string[];
      paidAt: Date | null;
      reconcileAckBy: string | null;
      reconcileAckAt: Date | null;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(params.page ?? 1, 1);
    const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 100);
    const status = params.status ?? 'reconcile_needed';

    const [orders, total] = await this.orderRepo.findAndCount({
      where: { status },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items: orders.map((order) => ({
        orderCode: order.orderCode,
        patronId: order.patronId,
        amount: Number(order.amount),
        status: order.status,
        paymentMethod: order.paymentMethod,
        recordIds: order.recordIds ?? [],
        reconcileReason: order.reconcileReason ?? null,
        reconcileAmount:
          order.reconcileAmount === null || order.reconcileAmount === undefined
            ? null
            : Number(order.reconcileAmount),
        alreadyPaidRecordIds: order.alreadyPaidRecordIds ?? [],
        settledRecordIds: order.settledRecordIds ?? [],
        paidAt: order.paidAt,
        reconcileAckBy: order.reconcileAckBy ?? null,
        reconcileAckAt: order.reconcileAckAt ?? null,
        createdAt: order.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Staff confirms the duplicate payment was refunded out-of-band (D4: the
   * refund itself stays a manual bank transfer; this only closes the ticket).
   */
  async acknowledgeReconcile(
    orderCode: string,
    staffId: string,
    note: string,
  ): Promise<{
    orderCode: string;
    status: PaymentOrderStatus;
    alreadyAcknowledged: boolean;
    reconcileAckBy: string | null;
    reconcileAckAt: Date | null;
  }> {
    const order = await this.orderRepo.findOne({ where: { orderCode } });
    if (!order) {
      throw new HttpError(404, `Không tìm thấy đơn thanh toán với mã: ${orderCode}`);
    }

    if (order.status === 'refunded') {
      return {
        orderCode: order.orderCode,
        status: order.status,
        alreadyAcknowledged: true,
        reconcileAckBy: order.reconcileAckBy ?? null,
        reconcileAckAt: order.reconcileAckAt ?? null,
      };
    }

    if (order.status !== 'reconcile_needed') {
      throw new HttpError(
        409,
        `Đơn ${orderCode} ở trạng thái ${order.status}, không cần đối soát`,
        'ORDER_NOT_IN_RECONCILE',
      );
    }

    const acknowledgedAt = new Date();
    order.status = 'refunded';
    order.reconcileAckBy = staffId;
    order.reconcileAckNote = note;
    order.reconcileAckAt = acknowledgedAt;
    await this.orderRepo.save(order);

    publishEvent('payment.refund_acknowledged', {
      orderCode: order.orderCode,
      patronId: order.patronId,
      amount: Number(order.reconcileAmount) || 0,
      acknowledgedBy: staffId,
      acknowledgedAt,
    });

    return {
      orderCode: order.orderCode,
      status: order.status,
      alreadyAcknowledged: false,
      reconcileAckBy: staffId,
      reconcileAckAt: acknowledgedAt,
    };
  }

  /**
   * Mark an order paid and settle the fine records behind it.
   *
   * Idempotency rules (BLF-PAY-01):
   * - The order is re-read from the database first, so a caller holding a stale
   *   object cannot bypass the terminal-state guard.
   * - A record that is already `finePaid` is never mutated. Money that arrives
   *   for an already-settled debt is quarantined as `reconcile_needed` so staff
   *   can refund it (D4), instead of silently double-charging the patron.
   * - Records are written BEFORE the order is flipped to `completed`. If the
   *   process dies in between, the retry sees records stamped with this order's
   *   own `paymentRef` and recovers them without opening a false refund ticket.
   *   The opposite ordering could leave an order `completed` with unpaid
   *   records, which no retry would ever fix.
   *
   * Known residual gap (follow-up BLF-PAY-02): there is no row lock, so two
   * writers that both read `finePaid = false` before either commits can still
   * race. Closing that needs a conditional write at the database layer
   * (`UPDATE borrow_records ... WHERE id = ANY($1) AND fine_paid = false
   * RETURNING id`) and a real Postgres integration harness.
   */
  private async settleCompletedOrder(
    order: PaymentOrder,
    gatewayTransId: string | null,
    receiptPayload: Record<string, any>,
  ): Promise<SettlementResult> {
    const now = new Date();

    // Re-read: the caller may be holding an order loaded before a concurrent
    // settlement (counter payment, another webhook).
    const fresh = await this.orderRepo.findOne({ where: { orderCode: order.orderCode } });
    const current = fresh ?? order;

    if (isTerminalOrderStatus(current.status)) {
      return {
        success: true,
        orderCode: current.orderCode,
        alreadyCompleted: true,
        activatedPatrons: [],
      };
    }

    current.paidAt = now;
    current.gatewayTransId = gatewayTransId;
    current.webhookPayload = receiptPayload;

    const records = await this.repo.findFineRecordsByIds(current.recordIds);

    // Money arrived but there is nothing left to settle — the debt rows were
    // deleted or the order never carried any. Never mark this `completed`.
    if (records.length === 0) {
      return this.openReconcileTicket(current, {
        reason: 'records_missing',
        amount: Number(current.amount) || 0,
        alreadyPaidRecordIds: current.recordIds ?? [],
        settledRecordIds: [],
      }, now);
    }

    const { settleable, alreadyPaid } = partitionSettlementRecords(records);
    // Records stamped with THIS order's code were written by an earlier attempt
    // of the same order (crash before the order save). Recover them silently.
    const settledByThisOrder = alreadyPaid.filter((record) => record.paymentRef === current.orderCode);
    const settledElsewhere = alreadyPaid.filter((record) => record.paymentRef !== current.orderCode);
    const settledRecordIds = [...settledByThisOrder, ...settleable].map((record) => record.id);

    // Records first: a crash here leaves the order retryable, never "paid but
    // unsettled". A failure throws and the gateway retries.
    await this.writeSettledRecords(current, settleable, now);

    if (settledElsewhere.length > 0) {
      return this.quarantineDuplicatePayment(
        current,
        settleable,
        settledElsewhere,
        settledRecordIds,
        now,
      );
    }

    current.status = 'completed';
    current.settledRecordIds = settledRecordIds;
    current.alreadyPaidRecordIds = [];
    current.reconcileReason = null;
    current.reconcileAmount = null;
    await this.orderRepo.save(current);

    const activatedPatrons = await this.autoUnlockCard(current);

    publishEvent('payment.completed', {
      orderCode: current.orderCode,
      patronId: current.patronId,
      amount: Number(current.amount),
      recordIds: current.settledRecordIds,
      paidAt: now,
    });

    return {
      success: true,
      orderCode: current.orderCode,
      alreadyCompleted: false,
      activatedPatrons,
    };
  }

  /**
   * Money arrived for a debt that was (partly) already settled elsewhere.
   * The still-unpaid subset has already been settled by the caller; this opens
   * the refund ticket for the overlap.
   */
  private async quarantineDuplicatePayment(
    current: PaymentOrder,
    settleable: BorrowRecord[],
    settledElsewhere: BorrowRecord[],
    settledRecordIds: string[],
    now: Date,
  ): Promise<SettlementResult> {
    if (settleable.length > 0) {
      publishEvent('payment.completed', {
        orderCode: current.orderCode,
        patronId: current.patronId,
        amount: sumRecordAmount(settleable),
        recordIds: settleable.map((record) => record.id),
        paidAt: now,
        partial: true,
      });
    }

    return this.openReconcileTicket(current, {
      reason: settledRecordIds.length === 0 ? 'all_records_already_paid' : 'partial_already_paid',
      amount: sumRecordAmount(settledElsewhere),
      alreadyPaidRecordIds: settledElsewhere.map((record) => record.id),
      settledRecordIds,
    }, now);
  }

  /**
   * Persist a `reconcile_needed` order so staff can refund it (D4). Never
   * touches the records that were already paid elsewhere.
   */
  private async openReconcileTicket(
    current: PaymentOrder,
    ticket: {
      reason: ReconcileReason;
      amount: number;
      alreadyPaidRecordIds: string[];
      settledRecordIds: string[];
    },
    now: Date,
  ): Promise<SettlementResult> {
    current.status = 'reconcile_needed';
    current.reconcileReason = ticket.reason;
    current.reconcileAmount = ticket.amount;
    current.alreadyPaidRecordIds = ticket.alreadyPaidRecordIds;
    current.settledRecordIds = ticket.settledRecordIds;
    await this.orderRepo.save(current);

    publishEvent('payment.reconcile_needed', {
      orderCode: current.orderCode,
      patronId: current.patronId,
      amount: ticket.amount,
      reason: ticket.reason,
      alreadyPaidRecordIds: ticket.alreadyPaidRecordIds,
      paidAt: now,
    });

    const activatedPatrons = await this.autoUnlockCard(current);

    return {
      success: true,
      orderCode: current.orderCode,
      alreadyCompleted: false,
      activatedPatrons,
      reconcile: {
        reason: ticket.reason,
        amount: ticket.amount,
        alreadyPaidRecordIds: ticket.alreadyPaidRecordIds,
        settledRecordIds: ticket.settledRecordIds,
      },
    };
  }

  /**
   * Write the records this payment settles. Deliberately does NOT touch the
   * order: if this throws, the order keeps its previous status and the gateway
   * retry re-runs the whole settlement.
   */
  private async writeSettledRecords(
    order: PaymentOrder,
    records: BorrowRecord[],
    paidAt: Date,
  ): Promise<void> {
    if (records.length === 0) return;
    this.markRecordsPaid(records, order, paidAt);
    await this.repo.saveBorrowRecords(records);
  }

  private markRecordsPaid(
    records: BorrowRecord[],
    order: PaymentOrder,
    paidAt: Date,
  ): void {
    for (const record of records) {
      record.finePaid = true;
      record.paymentMethod = order.paymentMethod;
      record.paymentRef = order.orderCode;
      record.paidAt = paidAt;
    }
  }

  /**
   * Auto-unlock the patron card when the settlement cleared their last debt.
   * Best-effort: a user-service outage must not fail the settlement.
   */
  private async autoUnlockCard(order: PaymentOrder): Promise<string[]> {
    const activatedPatrons: string[] = [];
    try {
      const hasDebt = await this.repo.hasUnpaidFinesForPatron(order.patronId);
      if (!hasDebt) {
        await activateCardAutoFine(order.patronId);
        activatedPatrons.push(order.patronId);
      }
    } catch (err: any) {
      console.warn('[settleCompletedOrder] card auto-activate best-effort failed:', err?.message);
    }
    return activatedPatrons;
  }
}
