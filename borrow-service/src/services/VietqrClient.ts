import crypto from 'crypto';

export interface VietqrClientConfig {
  baseUrl: string;
  username: string;
  password: string;
  bankCode: string;
  bankAccount: string;
  accountName: string;
  terminalCode?: string;
  timeoutMs?: number;
}

export interface VietqrQrResult {
  qrCode: string;
  qrLink: string;
  transactionRefId: string;
  orderId: string;
}

function resolveConfig(overrides?: Partial<VietqrClientConfig>): VietqrClientConfig {
  return {
    baseUrl: overrides?.baseUrl ?? process.env.VIETQR_API_BASE_URL ?? 'https://dev.vietqr.org',
    username: overrides?.username ?? process.env.VIETQR_API_USERNAME ?? '',
    password: overrides?.password ?? process.env.VIETQR_API_PASSWORD ?? '',
    bankCode: overrides?.bankCode ?? process.env.VIETQR_BANK_CODE ?? 'MB',
    bankAccount: overrides?.bankAccount ?? process.env.VIETQR_ACCOUNT_NUMBER ?? '0395324779',
    accountName: overrides?.accountName ?? process.env.VIETQR_ACCOUNT_NAME ?? 'THU VIEN DAI HOC CONG NGHIEP TPHCM',
    terminalCode: overrides?.terminalCode ?? process.env.VIETQR_TERMINAL_CODE,
    timeoutMs: overrides?.timeoutMs ?? 10000,
  };
}

/**
 * VietQR orderId: max 13 chars, latin letters/digits only, no special chars.
 * Our internal orderCode (TXN-...+uuid, 22 chars with dashes) is NOT valid,
 * so a short surrogate id is generated and mapped 1:1 in payment_orders.
 */
export function generateVietqrOrderId(): string {
  return crypto.randomBytes(9).toString('base64')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 12)
    .toUpperCase()
    .padEnd(12, '0');
}

export class VietqrClient {
  private readonly config: VietqrClientConfig;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(overrides?: Partial<VietqrClientConfig>) {
    this.config = resolveConfig(overrides);
  }

  isEnabled(): boolean {
    return Boolean(this.config.username && this.config.password);
  }

  async getToken(): Promise<string> {
    // 60s safety margin before the 300s VietQR expiry
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.cachedToken;
    }
    const basic = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    const res = await this.post<{ access_token: string; expires_in: number }>(
      '/vqr/api/token_generate',
      {},
      { Authorization: `Basic ${basic}` },
    );
    if (!res.access_token) {
      throw new Error('VietQR getToken: missing access_token in response');
    }
    this.cachedToken = res.access_token;
    this.tokenExpiresAt = Date.now() + (Number(res.expires_in) || 300) * 1000;
    return this.cachedToken;
  }

  async generateDynamicQr(input: { orderId: string; content: string; amount: number }): Promise<VietqrQrResult> {
    const token = await this.getToken();
    const res = await this.post<any>(
      '/vqr/api/qr/generate-customer',
      {
        bankCode: this.config.bankCode,
        bankAccount: this.config.bankAccount,
        userBankName: this.config.accountName,
        content: input.content,
        qrType: 0,
        amount: Math.round(input.amount),
        orderId: input.orderId,
        transType: 'C',
        ...(this.config.terminalCode ? { terminalCode: this.config.terminalCode } : {}),
      },
      { Authorization: `Bearer ${token}` },
    );
    if (!res || !res.qrCode) {
      throw new Error(`VietQR generateQr failed: ${JSON.stringify(res).slice(0, 300)}`);
    }
    return {
      qrCode: res.qrCode,
      qrLink: res.qrLink ?? '',
      transactionRefId: res.transactionRefId ?? '',
      orderId: res.orderId ?? input.orderId,
    };
  }

  /** Sandbox-only: ask VietQR to fire a real callback at our transaction-sync endpoint. */
  async testCallback(input: { content: string; amount: number; transType?: 'C' | 'D' }): Promise<void> {
    const token = await this.getToken();
    await this.post(
      '/vqr/bank/api/test/transaction-callback',
      {
        bankAccount: this.config.bankAccount,
        bankCode: this.config.bankCode,
        content: input.content,
        amount: String(Math.round(input.amount)),
        transType: input.transType ?? 'C',
      },
      { Authorization: `Bearer ${token}` },
    );
  }

  private async post<T>(path: string, body: Record<string, any>, headers: Record<string, string>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as T | null;
      if (!res.ok) {
        throw new Error(`VietQR ${path} HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
      }
      return data as T;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`VietQR ${path} timed out after ${this.config.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export default VietqrClient;
