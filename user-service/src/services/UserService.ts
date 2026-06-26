import { AppDataSource } from '../data-source';
import { User } from '../entities/User.entity';
import { UserRepository } from '../repositories/UserRepository';
import { PatronRepository } from '../repositories/PatronRepository';
import { RedisService } from './RedisService';
import { CloudinaryService } from './CloudinaryService';
import { UserPublicDto } from '../dto';
import { NotFoundError, BadRequestError } from '../errors';

export class UserService {
  constructor(
    private userRepo: UserRepository,
    private patronRepo: PatronRepository,
    private redis: RedisService,
  ) {}

  async getAllUsers(): Promise<{ users: UserPublicDto[]; total: number }> {
    const [users, total] = await this.userRepo.findAll();
    return {
      users: users.map(this.toPublic),
      total,
    };
  }

  async getUserById(id: string): Promise<any> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');
    return {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
      student_code: user.studentCode,
      class_name: user.className,
      phone: user.phone,
      card_number: user.cardNumber,
      status: user.status,
      current_status: user.currentStatus,
      last_entry_at: user.lastEntryAt,
      last_entry_camera: user.lastEntryCamera,
      membership_expiry: user.membershipExpiry,
      avatar_url: user.avatarUrl,
      created_at: user.createdAt,
    };
  }

  async updateAvatar(userId: string, buffer: Buffer, mimeType: string): Promise<string> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const cloudinarySvc = new CloudinaryService();
    const avatarUrl = await cloudinarySvc.uploadAvatar(userId, buffer, mimeType);
    await this.userRepo.update(userId, { avatarUrl });
    return avatarUrl;
  }

  async deleteAvatar(userId: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const cloudinarySvc = new CloudinaryService();
    await cloudinarySvc.deleteAvatar(userId);
    await this.userRepo.update(userId, { avatarUrl: null });
  }

  async updateAccessStatus(
    id: string,
    currentStatus: 'inside' | 'outside',
    cameraId?: string | null,
  ): Promise<any> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const updates: any = { currentStatus };
    if (currentStatus === 'inside') {
      updates.lastEntryAt = new Date();
      updates.lastEntryCamera = cameraId ?? null;
    }

    const updated = await this.userRepo.update(id, updates);
    return this.getUserById(updated!.id);
  }

  async deleteUser(id: string): Promise<{ deleted: boolean; id: string; soft: boolean }> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.update(User, id, { status: 'deleted' as any });
      await this.redis.publishUserDeleted(id, user.email);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return { deleted: true, id, soft: true };
  }

  async restoreUser(id: string): Promise<UserPublicDto> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    if (user.status !== 'deleted') {
      throw new BadRequestError('User is not deleted');
    }

    await this.userRepo.update(id, { status: 'active' });
    this.redis.publishUserUpdated(id, user.email);

    return this.getUserById(id);
  }

  private toPublic(user: any): UserPublicDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      avatarUrl: user.avatarUrl,
    };
  }
}
