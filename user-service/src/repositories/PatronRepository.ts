import { User } from '../entities/User.entity';
import { UserRepository } from './UserRepository';

export class PatronRepository extends UserRepository {
  async findPatrons(options?: {
    query?: string;
    status?: string;
    skip?: number;
    limit?: number;
  }): Promise<[User[], number]> {
    const qb = this.repo
      .createQueryBuilder('user')
      .where('user.role = :role', { role: 'patron' });

    if (options?.query) {
      qb.andWhere(
        '(user.fullName ILIKE :q OR user.studentCode ILIKE :q OR user.cardNumber ILIKE :q)',
        { q: `%${options.query}%` },
      );
    }

    if (options?.status) {
      qb.andWhere('user.status = :status', { status: options.status });
    }

    return qb
      .skip(options?.skip ?? 0)
      .take(options?.limit ?? 20)
      .orderBy('user.createdAt', 'DESC')
      .getManyAndCount();
  }

  async getActivePatrons(): Promise<User[]> {
    return this.repo.find({
      where: {
        role: 'patron',
        currentStatus: 'inside',
        status: 'active',
      },
    });
  }

  async countActivePatrons(): Promise<number> {
    return this.repo.count({ where: { role: 'patron', status: 'active' } });
  }

  async countActiveInside(): Promise<number> {
    return this.repo.count({
      where: { role: 'patron', currentStatus: 'inside', status: 'active' },
    });
  }

  async deleteFacesByUserId(userId: string): Promise<void> {
    await this.repo.manager
      .createQueryBuilder()
      .delete()
      .from('patron_faces')
      .where('patron_id = :userId', { userId })
      .execute();
  }

  async deleteAccessLogsByUserId(userId: string): Promise<void> {
    await this.repo.manager
      .createQueryBuilder()
      .delete()
      .from('access_logs')
      .where('patron_id = :userId', { userId })
      .execute();
  }

  async updateCurrentStatus(
    id: string,
    status: string,
    lastEntryAt?: Date,
    lastEntryCamera?: string,
  ): Promise<void> {
    await this.repo.update(id, {
      currentStatus: status,
      lastEntryAt: lastEntryAt ?? null,
      lastEntryCamera: lastEntryCamera ?? null,
    });
  }
}
