import { AppDataSource } from '../data-source';
import { SystemConfig } from '../entities/SystemConfig';
import { config as envConfig } from '../config';
import { publishEvent } from '../utils/eventPublisher';
import type { FineBracket } from '../utils/fineCalculator';

function parseDamageMap(raw: unknown, fallback: { minor: number; major: number; lost: number }) {
  let parsed: any = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = undefined;
    }
  }
  if (parsed && typeof parsed === 'object') {
    return {
      minor: parsed.minor !== undefined ? Number(parsed.minor) : fallback.minor,
      major: parsed.major !== undefined ? Number(parsed.major) : fallback.major,
      lost: parsed.lost !== undefined ? Number(parsed.lost) : fallback.lost,
    };
  }
  return { ...fallback };
}

const repo = () => AppDataSource.getRepository(SystemConfig);

export interface BorrowLimits {
  maxBorrowDays: number;
  maxBorrowBooks: number;
  maxBorrowBooksPerSlip: number;
  maxRenewals: number;
}

export interface FineConfig {
  fineBrackets: FineBracket[];
  finePerDay: number;
  damageFeePct: { minor: number; major: number; lost: number };
  damageFeeFixed: { minor: number; major: number; lost: number };
  fallbackBookPrice: number;
  fineLockThresholdDays: number;
}

const DEFAULT_DAMAGE_FEE_PCT = { minor: 30, major: 70, lost: 100 };
const DEFAULT_DAMAGE_FEE_FIXED = { minor: 5000, major: 10000, lost: 10000 };
const DEFAULT_FALLBACK_BOOK_PRICE = 100000;
const DEFAULT_FINE_LOCK_THRESHOLD_DAYS = 30;

let cachedBorrowLimits: BorrowLimits | null = null;
let cachedFineConfig: FineConfig | null = null;
let lastBorrowCacheTime = 0;
let lastFineCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

export function invalidateConfigCache() {
  cachedBorrowLimits = null;
  cachedFineConfig = null;
  lastBorrowCacheTime = 0;
  lastFineCacheTime = 0;
}

export class ConfigService {
  async getAll(): Promise<Record<string, SystemConfigEntry[]>> {
    const configs = await repo().find({ order: { category: 'ASC', configKey: 'ASC' } });
    const grouped: Record<string, SystemConfigEntry[]> = {};
    for (const c of configs) {
      if (!grouped[c.category]) grouped[c.category] = [];
      grouped[c.category].push({
        id: c.id,
        category: c.category,
        config_key: c.configKey,
        config_value: c.isEncrypted ? '••••••••' : c.configValue,
        label: c.label,
        description: c.description,
        is_encrypted: c.isEncrypted,
        updated_at: c.updatedAt.toISOString(),
        updated_by: c.updatedBy,
      });
    }
    return grouped;
  }

  async getByCategory(category: string): Promise<SystemConfigEntry[]> {
    const configs = await repo().find({
      where: { category },
      order: { configKey: 'ASC' },
    });
    if (configs.length === 0) throw new NotFoundError(`Category "${category}" not found`);
    return configs.map((c) => ({
      id: c.id,
      category: c.category,
      config_key: c.configKey,
      config_value: c.isEncrypted ? '••••••••' : c.configValue,
      label: c.label,
      description: c.description,
      is_encrypted: c.isEncrypted,
      updated_at: c.updatedAt.toISOString(),
      updated_by: c.updatedBy,
    }));
  }

  async updateCategory(
    category: string,
    values: Record<string, any>,
    updatedBy: string | null,
  ): Promise<SystemConfigEntry[]> {
    const configs = await repo().find({ where: { category } });
    if (configs.length === 0) throw new NotFoundError(`Category "${category}" not found`);

    for (const config of configs) {
      if (config.configKey in values) {
        const newValue = values[config.configKey];
        if (config.isEncrypted && newValue === '••••••••') continue;
        config.configValue = newValue;
        config.updatedBy = updatedBy;
        config.updatedAt = new Date();
      }
    }
    await repo().save(configs);

    // Invalidate local in-memory cache immediately so next calls get latest DB values
    invalidateConfigCache();

    // Broadcast config update event over AMQP for other services (e.g. notification-service, automation-service)
    try {
      await publishEvent('config.updated', {
        category,
        values,
        updatedBy,
        timestamp: new Date().toISOString(),
      });
      await publishEvent('system.config.updated', {
        category,
        keys: Object.keys(values),
        values,
        updatedBy,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.warn('[ConfigService] Failed to broadcast config update event:', err.message);
    }

    return configs.map((c) => ({
      id: c.id,
      category: c.category,
      config_key: c.configKey,
      config_value: c.isEncrypted ? '••••••••' : c.configValue,
      label: c.label,
      description: c.description,
      is_encrypted: c.isEncrypted,
      updated_at: c.updatedAt.toISOString(),
      updated_by: c.updatedBy,
    }));
  }

  async getBorrowLimits(): Promise<BorrowLimits> {
    const now = Date.now();
    if (cachedBorrowLimits && now - lastBorrowCacheTime < CACHE_TTL_MS) {
      return cachedBorrowLimits;
    }

    try {
      const configs = await repo().find({ where: { category: 'borrow' } });
      const map: Record<string, any> = {};
      for (const c of configs) {
        map[c.configKey] = c.configValue;
      }

      cachedBorrowLimits = {
        maxBorrowDays: map['max_borrow_days'] !== undefined ? Number(map['max_borrow_days']) : envConfig.maxBorrowDays,
        maxBorrowBooks: map['max_borrow_books'] !== undefined ? Number(map['max_borrow_books']) : envConfig.maxBorrowBooks,
        maxBorrowBooksPerSlip: map['max_borrow_books_per_slip'] !== undefined ? Number(map['max_borrow_books_per_slip']) : envConfig.maxBorrowBooksPerSlip,
        maxRenewals: map['max_renewals'] !== undefined ? Number(map['max_renewals']) : envConfig.maxRenewals,
      };
      lastBorrowCacheTime = now;
      return cachedBorrowLimits;
    } catch (err: any) {
      console.warn('[ConfigService] Failed to read borrow limits from DB, falling back to envConfig:', err.message);
      return {
        maxBorrowDays: envConfig.maxBorrowDays,
        maxBorrowBooks: envConfig.maxBorrowBooks,
        maxBorrowBooksPerSlip: envConfig.maxBorrowBooksPerSlip,
        maxRenewals: envConfig.maxRenewals,
      };
    }
  }

  async getFineConfig(): Promise<FineConfig> {
    const now = Date.now();
    if (cachedFineConfig && now - lastFineCacheTime < CACHE_TTL_MS) {
      return cachedFineConfig;
    }

    try {
      const configs = await repo().find({ where: { category: 'fine' } });
      const map: Record<string, any> = {};
      for (const c of configs) {
        map[c.configKey] = c.configValue;
      }

      let brackets = map['fine_brackets'];
      if (typeof brackets === 'string') {
        try {
          brackets = JSON.parse(brackets);
        } catch {
          // ignore parse error
        }
      }

      cachedFineConfig = {
        fineBrackets: Array.isArray(brackets) ? brackets : [],
        finePerDay: map['fine_per_day'] !== undefined ? Number(map['fine_per_day']) : envConfig.finePerDay,
        damageFeePct: parseDamageMap(map['damage_fee_pct'], DEFAULT_DAMAGE_FEE_PCT),
        damageFeeFixed: parseDamageMap(map['damage_fee_fixed'], DEFAULT_DAMAGE_FEE_FIXED),
        fallbackBookPrice: map['fallback_book_price'] !== undefined ? Number(map['fallback_book_price']) : DEFAULT_FALLBACK_BOOK_PRICE,
        fineLockThresholdDays: map['fine_lock_threshold_days'] !== undefined ? Number(map['fine_lock_threshold_days']) : DEFAULT_FINE_LOCK_THRESHOLD_DAYS,
      };
      lastFineCacheTime = now;
      return cachedFineConfig;
    } catch (err: any) {
      console.warn('[ConfigService] Failed to read fine config from DB, falling back to defaults:', err.message);
      return {
        fineBrackets: [],
        finePerDay: envConfig.finePerDay,
        damageFeePct: { ...DEFAULT_DAMAGE_FEE_PCT },
        damageFeeFixed: { ...DEFAULT_DAMAGE_FEE_FIXED },
        fallbackBookPrice: DEFAULT_FALLBACK_BOOK_PRICE,
        fineLockThresholdDays: DEFAULT_FINE_LOCK_THRESHOLD_DAYS,
      };
    }
  }

  async testEmail(config: {
    to: string;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  }): Promise<{ success: boolean; message: string }> {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
    });
    try {
      await transporter.verify();
      await transporter.sendMail({
        from: config.from,
        to: config.to,
        subject: '[ThuVienIUH] Test kết nối SMTP',
        text: 'Cấu hình email SMTP đã hoạt động thành công!',
      });
      return { success: true, message: 'Gửi email test thành công' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Không thể gửi email test' };
    }
  }
}

export const configService = new ConfigService();

export interface SystemConfigEntry {
  id: string;
  category: string;
  config_key: string;
  config_value: any;
  label: string;
  description: string | null;
  is_encrypted: boolean;
  updated_at: string;
  updated_by: string | null;
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

