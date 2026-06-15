import { UserRepository } from '../repositories/UserRepository';
import { PatronRepository } from '../repositories/PatronRepository';
import { RedisService } from './RedisService';
import { UserPublicDto } from '../dto';
import { NotFoundError } from '../errors';

export class UserService {
  constructor(
    private userRepo: UserRepository,
    private patronRepo: PatronRepository,
    private redis: RedisService,
  ) {}

  async getAllUsers(): Promise<UserPublicDto[]> {
    const [users] = await this.userRepo.findAll();
    return users.map(this.toPublic);
  }

  async getUserById(id: string): Promise<any> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      studentCode: user.studentCode,
      className: user.className,
      phone: user.phone,
      cardNumber: user.cardNumber,
      status: user.status,
      currentStatus: user.currentStatus,
      lastEntryAt: user.lastEntryAt,
      lastEntryCamera: user.lastEntryCamera,
      membershipExpiry: user.membershipExpiry,
      createdAt: user.createdAt,
    };
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

  async deleteUser(id: string): Promise<{ deleted: boolean; id: string }> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    await this.userRepo.delete(id);
    await this.redis.publishUserDeleted(id, user.email);

    return { deleted: true, id };
  }

  private toPublic(user: any): UserPublicDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
  }
}
