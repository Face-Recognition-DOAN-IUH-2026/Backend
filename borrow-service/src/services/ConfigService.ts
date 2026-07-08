import { AppDataSource } from '../data-source';
import { SystemConfig } from '../entities/SystemConfig';

const repo = () => AppDataSource.getRepository(SystemConfig);

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
