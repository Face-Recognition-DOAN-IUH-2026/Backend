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
      membershipExpiry: user.membershipExpiry,
      createdAt: user.createdAt,
    };
  }

  async deleteUser(id: string): Promise<{ deleted: boolean; id: string }> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    await this.patronRepo.deleteFacesByUserId(id);
    await this.patronRepo.deleteAccessLogsByUserId(id);
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
