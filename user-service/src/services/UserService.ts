import { AppDataSource } from '../data-source';
import { User } from '../entities/User.entity';
import { UserRepository } from '../repositories/UserRepository';
import { PatronRepository } from '../repositories/PatronRepository';
import { RedisService } from './RedisService';
import { CloudinaryService } from './CloudinaryService';
import { UserPublicDto } from '../dto';
import { NotFoundError, BadRequestError, UnauthorizedError } from '../errors';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getServiceToken } from '../../../shared';
import axios from 'axios';
import { config } from '../config';
import { accessServiceClient } from '../clients/AccessServiceClient';

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

    try {
      await accessServiceClient.setPatronStatus(id, currentStatus, cameraId || undefined);
    } catch (err) {
      console.error('[UserService] Failed to sync status to access-service:', err);
    }

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
      if (user.status === 'deleted' || user.role === 'admin' || user.role === 'staff') {
        // Hard delete for already deleted users, or for admin/staff immediately
        await queryRunner.manager.delete(User, id);
        await this.redis.publishUserDeleted(id, user.email);
        await queryRunner.commitTransaction();
        return { deleted: true, id, soft: false };
      } else {
        // Soft delete for active users
        await queryRunner.manager.update(User, id, { status: 'deleted' as any });
        await this.redis.publishUserDeleted(id, user.email);
        await queryRunner.commitTransaction();
        return { deleted: true, id, soft: true };
      }
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
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

  async updateProfile(id: string, updates: { fullName?: string; phone?: string; permanentAddress?: string }): Promise<UserPublicDto> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const updateData: any = {};
    if (updates.fullName !== undefined) updateData.fullName = updates.fullName;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.permanentAddress !== undefined) updateData.permanentAddress = updates.permanentAddress;

    await this.userRepo.update(id, updateData);
    this.redis.publishUserUpdated(id, user.email);
    
    const updatedUser = await this.userRepo.findById(id);
    return this.toPublic(updatedUser!);
  }

  async changePassword(id: string, oldPass: string, newPass: string): Promise<void> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const isMatch = await bcrypt.compare(oldPass, user.passwordHash);
    if (!isMatch) throw new UnauthorizedError('Mat khau hien tai khong dung');

    const passwordHash = await bcrypt.hash(newPass, 10);
    await this.userRepo.update(id, { passwordHash });
  }

  async requestEmailChangeOtp(id: string, newEmail: string): Promise<void> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const normalizedEmail = newEmail.trim().toLowerCase();
    const existing = await this.userRepo.findByEmail(normalizedEmail);
    if (existing && existing.id !== id) {
      throw new BadRequestError('Email nay da duoc su dung');
    }

    const code = crypto.randomInt(100000, 999999).toString();
    // Reusing the password reset or verification code logic in Redis, or create a new one.
    // We'll create a new redis method or use a generic one if possible, but wait, RedisService might not have setEmailChangeCode.
    // Let's use setEmailVerificationCode but with the newEmail.
    await this.redis.setEmailVerificationCode(normalizedEmail, code);

    try {
      await axios.post(
        `${config.notificationServiceUrl}/internal/send-email-change`,
        { toEmail: normalizedEmail, code },
        { headers: { 'Authorization': `Bearer ${getServiceToken('user-service', config.jwtSecret)}` } }
      );
    } catch (e: any) {
      console.error('[UserService] Failed to send email change OTP:', e.response?.status, e.response?.data || e.message);
      throw new Error('Khong the gui email, vui long thu lai sau');
    }
  }

  async verifyAndChangeEmail(id: string, newEmail: string, code: string): Promise<void> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const normalizedEmail = newEmail.trim().toLowerCase();
    const storedCode = await this.redis.getEmailVerificationCode(normalizedEmail);
    
    if (!storedCode || storedCode !== code) {
      throw new BadRequestError('Ma xac thuc khong hop le hoac da het han');
    }

    const existing = await this.userRepo.findByEmail(normalizedEmail);
    if (existing && existing.id !== id) {
      throw new BadRequestError('Email nay da duoc su dung');
    }

    await this.userRepo.update(id, { email: normalizedEmail });
    await this.redis.deleteEmailVerificationCode(normalizedEmail);
    this.redis.publishUserUpdated(id, normalizedEmail);
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
