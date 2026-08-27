import { AppDataSource } from '../data-source';
import { DeviceToken } from '../entities/DeviceToken';

const repo = () => AppDataSource.getRepository(DeviceToken);

export class DeviceTokenService {
  async register(userId: string, token: string, platform: 'ios' | 'android' | 'web'): Promise<DeviceToken> {
    const existing = await repo().findOne({ where: { token } });
    if (existing) {
      existing.userId = userId;
      existing.platform = platform;
      return repo().save(existing);
    }
    const entity = repo().create({ userId, token, platform });
    return repo().save(entity);
  }

  async unregister(token: string): Promise<boolean> {
    const result = await repo().delete({ token });
    return (result.affected ?? 0) > 0;
  }

  async getTokensByUser(userId: string): Promise<DeviceToken[]> {
    return repo().find({ where: { userId } });
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await repo().delete({ userId });
    return result.affected ?? 0;
  }
}

export const deviceTokenService = new DeviceTokenService();
