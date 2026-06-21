import { AppDataSource } from '../data-source';
import { Notification } from '../entities/Notification';

const repo = () => AppDataSource.getRepository(Notification);

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

export class NotificationService {
  async create(input: CreateNotificationInput): Promise<Notification> {
    const entity = repo().create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data || null,
    });
    return repo().save(entity);
  }

  async createMany(inputs: CreateNotificationInput[]): Promise<Notification[]> {
    const entities = inputs.map((input) =>
      repo().create({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data || null,
      })
    );
    return repo().save(entities);
  }

  async list(userId: string, options: { unreadOnly?: boolean; skip?: number; limit?: number } = {}): Promise<{ items: Notification[]; total: number; unread: number }> {
    const { unreadOnly = false, skip = 0, limit = 20 } = options;

    const qb = repo().createQueryBuilder('n').where('n.user_id = :userId', { userId });

    if (unreadOnly) {
      qb.andWhere('n.is_read = false');
    }

    qb.orderBy('n.created_at', 'DESC').skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    const unread = await repo().count({ where: { userId, isRead: false } });

    return { items, total, unread };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return repo().count({ where: { userId, isRead: false } });
  }

  async markAsRead(id: string, userId: string): Promise<Notification | null> {
    const entity = await repo().findOne({ where: { id, userId } });
    if (!entity || entity.isRead) return entity;
    entity.isRead = true;
    entity.readAt = new Date();
    return repo().save(entity);
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await repo()
      .createQueryBuilder()
      .update(Notification)
      .set({ isRead: true, readAt: new Date() })
      .where('user_id = :userId AND is_read = false', { userId })
      .execute();
    return result.affected || 0;
  }

  async findById(id: string): Promise<Notification | null> {
    return repo().findOne({ where: { id } });
  }

  async deleteOlderThan(userId: string, days: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const result = await repo()
      .createQueryBuilder()
      .delete()
      .where('user_id = :userId AND created_at < :cutoff', { userId, cutoff })
      .execute();
    return result.affected || 0;
  }
}

export const notificationService = new NotificationService();
