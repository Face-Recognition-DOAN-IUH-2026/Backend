import { AppDataSource } from '../data-source';
import { User } from '../entities/User.entity';
import { UserRepository } from '../repositories/UserRepository';
import { PatronRepository } from '../repositories/PatronRepository';
import { RedisService } from './RedisService';
import { CloudinaryService } from './CloudinaryService';
import { UserPublicDto } from '../dto';
import { NotFoundError, BadRequestError, UnauthorizedError, ForbiddenError } from '../errors';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getServiceToken } from '../../../shared/auth';
import { CircuitBreaker } from '../../../shared/utils/circuitBreaker';
import { retryWithBackoff } from '../../../shared/utils/retryWithBackoff';
import axios from 'axios';
import { config } from '../config';
import { accessServiceClient } from '../clients/AccessServiceClient';
import { faceServiceClient } from '../clients/FaceServiceClient';

const notificationCircuit = new CircuitBreaker(5, 60_000);

export class UserService {
  constructor(
    private userRepo: UserRepository,
    private patronRepo: PatronRepository,
    private redis: RedisService,
  ) {}

  async getAllUsers(skip = 0, limit = 200): Promise<{ users: UserPublicDto[]; total: number }> {
    const [users, total] = await this.userRepo.findAll(skip, limit);
    const result: UserPublicDto[] = [];
    for (const user of users) {
      let hasFace = false;
      try {
        hasFace = await faceServiceClient.checkEnrollment(user.id);
      } catch {
        hasFace = false;
      }
      result.push(this.toPublic(user, hasFace));
    }
    return { users: result, total };
  }

  async getUserById(id: string): Promise<any> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');
    let hasFace = false;
    try {
      hasFace = await faceServiceClient.checkEnrollment(user.id);
    } catch (error) {
      console.error(`[UserService] Failed to check face enrollment for ${user.id}:`, error);
    }
    return {
      ...this.toPublic(user, hasFace),
      password_hash: undefined,
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

  async adminUpdateUser(id: string, updates: {
    fullName?: string;
    phone?: string;
    studentCode?: string | null;
    className?: string | null;
    identityNumber?: string | null;
    course?: string | null;
    permanentAddress?: string | null;
    cardNumber?: string | null;
    issueDate?: string | null;
    membershipExpiry?: string | null;
    role?: string;
    status?: string;
    suspendedReason?: string | null;
    avatarUrl?: string | null;
  }): Promise<UserPublicDto> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const updateData: any = {};

    if (updates.fullName !== undefined) updateData.fullName = updates.fullName || null;
    if (updates.phone !== undefined) updateData.phone = updates.phone || null;
    if (updates.studentCode !== undefined) updateData.studentCode = updates.studentCode || null;
    if (updates.className !== undefined) updateData.className = updates.className || null;
    if (updates.identityNumber !== undefined) updateData.identityNumber = updates.identityNumber || null;
    if (updates.course !== undefined) updateData.course = updates.course || null;
    if (updates.permanentAddress !== undefined) updateData.permanentAddress = updates.permanentAddress || null;
    if (updates.cardNumber !== undefined) updateData.cardNumber = updates.cardNumber || null;
    if (updates.issueDate !== undefined) updateData.issueDate = updates.issueDate || null;
    if (updates.membershipExpiry !== undefined) updateData.membershipExpiry = updates.membershipExpiry || null;
    if (updates.role !== undefined) {
      if (!['patron', 'staff', 'admin', 'user'].includes(updates.role)) {
        throw new BadRequestError('Vai trò không hợp lệ');
      }
      updateData.role = updates.role;
    }
    if (updates.status !== undefined) {
      if (!['active', 'suspended', 'inactive'].includes(updates.status)) {
        throw new BadRequestError('Trạng thái không hợp lệ');
      }
      updateData.status = updates.status;
      if (updates.status === 'suspended' && updates.suspendedReason) {
        updateData.suspendedReason = updates.suspendedReason;
      } else if (updates.status === 'active') {
        updateData.suspendedReason = null;
      }
    }
    if (updates.avatarUrl !== undefined) updateData.avatarUrl = updates.avatarUrl || null;

    if (updateData.studentCode !== undefined && updateData.studentCode !== null) {
      const existing = await this.userRepo.findByStudentCode(updateData.studentCode);
      if (existing && existing.id !== id) {
        throw new BadRequestError('Mã sinh viên đã được sử dụng');
      }
    }

    if (updateData.cardNumber !== undefined && updateData.cardNumber !== null) {
      const existing = await this.userRepo.findByCardNumber(updateData.cardNumber);
      if (existing && existing.id !== id) {
        throw new BadRequestError('Số thẻ đã được sử dụng');
      }
    }

    await this.userRepo.update(id, updateData);
    this.redis.publishUserUpdated(id, user.email);

    return this.getUserById(id);
  }

  async updateProfile(id: string, updates: { fullName?: string; phone?: string; permanentAddress?: string }): Promise<Record<string, any>> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const updateData: any = {};
    if (updates.fullName !== undefined) updateData.fullName = updates.fullName;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.permanentAddress !== undefined) updateData.permanentAddress = updates.permanentAddress;

    await this.userRepo.update(id, updateData);
    this.redis.publishUserUpdated(id, user.email);

    const updatedUser = await this.userRepo.findById(id);
    return this.toPublic(updatedUser!, false);
  }

  private validatePasswordStrength(password: string): void {
    if (!password || password.length < 8) {
      throw new BadRequestError('Mật khẩu mới phải có tối thiểu 8 ký tự');
    }
    if (password.length > 32) {
      throw new BadRequestError('Mật khẩu mới không được vượt quá 32 ký tự');
    }
    if (/\s/.test(password)) {
      throw new BadRequestError('Mật khẩu không được chứa khoảng trắng');
    }
    if (!/[A-Z]/.test(password)) {
      throw new BadRequestError('Mật khẩu phải chứa ít nhất 1 chữ cái in hoa (A-Z)');
    }
    if (!/[a-z]/.test(password)) {
      throw new BadRequestError('Mật khẩu phải chứa ít nhất 1 chữ cái in thường (a-z)');
    }
    if (!/[0-9]/.test(password)) {
      throw new BadRequestError('Mật khẩu phải chứa ít nhất 1 chữ số (0-9)');
    }
  }

  async requestPasswordChangeOtp(id: string, oldPass: string, newPass: string): Promise<void> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    // Chống brute-force: kiểm tra số lần thử sai
    const failCount = await this.redis.getFailedPasswordAttempts(id);
    if (failCount >= 5) {
      throw new ForbiddenError('Tài khoản đã nhập sai mật khẩu quá 5 lần. Vui lòng thử lại sau 15 phút để đảm bảo an toàn.');
    }

    const isMatch = await bcrypt.compare(oldPass, user.passwordHash);
    if (!isMatch) {
      const count = await this.redis.recordFailedPasswordAttempt(id);
      const remaining = Math.max(0, 5 - count);
      throw new UnauthorizedError(
        'Mật khẩu hiện tại không chính xác' +
        (remaining > 0 ? ` (Còn ${remaining} lần thử trước khi bị tạm khóa)` : ' (Tài khoản đã bị tạm khóa 15 phút)')
      );
    }

    // Xóa bộ đếm sai khi nhập đúng mật khẩu
    await this.redis.clearFailedPasswordAttempts(id);

    if (oldPass === newPass) {
      throw new BadRequestError('Mật khẩu mới không được trùng với mật khẩu hiện tại');
    }

    this.validatePasswordStrength(newPass);

    const pendingHash = await bcrypt.hash(newPass, 10);
    const code = crypto.randomInt(100000, 999999).toString();
    await this.redis.setPasswordChangeOtp(id, code, pendingHash);

    try {
      await retryWithBackoff(async () => {
        if (!notificationCircuit.canRequest()) {
          throw new Error('Notification service temporarily unavailable');
        }
        try {
          const response = await axios.post(
            `${config.notificationServiceUrl}/internal/send-password-change-otp`,
            { toEmail: user.email, code },
            {
              headers: { Authorization: `Bearer ${getServiceToken('user-service', config.jwtSecret)}` },
              timeout: 5000,
            }
          );
          notificationCircuit.recordSuccess();
          return response;
        } catch (err: any) {
          if (err?.response?.status >= 500 || err?.code === 'ECONNABORTED' || err?.code === 'ECONNREFUSED') {
            notificationCircuit.recordFailure();
          }
          throw err;
        }
      }, 2, 500);
    } catch (e: any) {
      console.error('[UserService] Failed to send password change OTP:', e.response?.status, e.response?.data || e.message);
      throw new Error('Không thể gửi mã xác thực qua email, vui lòng thử lại sau');
    }
  }

  async verifyAndChangePassword(id: string, code: string, newPass?: string): Promise<void> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const storedCode = await this.redis.getPasswordChangeOtp(id);
    if (!storedCode || storedCode !== code.trim()) {
      throw new UnauthorizedError('Mã OTP không hợp lệ hoặc đã hết hạn');
    }

    let passwordHash = await this.redis.getPendingPasswordHash(id);
    if (!passwordHash && newPass) {
      this.validatePasswordStrength(newPass);
      passwordHash = await bcrypt.hash(newPass, 10);
    }
    if (!passwordHash) {
      throw new BadRequestError('Không tìm thấy thông tin mật khẩu mới cần cập nhật');
    }

    await this.userRepo.update(id, { passwordHash, passwordAutoGenerated: false });
    await this.redis.deletePasswordChangeOtp(id);
    await this.redis.clearFailedPasswordAttempts(id);

    // Gửi email cảnh báo bảo mật
    try {
      await axios.post(
        `${config.notificationServiceUrl}/internal/send-password-changed-alert`,
        { toEmail: user.email },
        {
          headers: { Authorization: `Bearer ${getServiceToken('user-service', config.jwtSecret)}` },
          timeout: 5000,
        }
      ).catch((err) => console.warn('Failed to send security alert email:', err.message));
    } catch (err: any) {
      console.warn('Failed to send security alert:', err?.message);
    }

    this.redis.publishUserUpdated(id, user.email);
  }

  async changePassword(id: string, oldPass: string, newPass: string, code?: string): Promise<void> {
    if (code) {
      return await this.verifyAndChangePassword(id, code, newPass);
    }

    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    // Chống brute-force
    const failCount = await this.redis.getFailedPasswordAttempts(id);
    if (failCount >= 5) {
      throw new ForbiddenError('Tài khoản đã nhập sai mật khẩu quá 5 lần. Vui lòng thử lại sau 15 phút để đảm bảo an toàn.');
    }

    const isMatch = await bcrypt.compare(oldPass, user.passwordHash);
    if (!isMatch) {
      const count = await this.redis.recordFailedPasswordAttempt(id);
      const remaining = Math.max(0, 5 - count);
      throw new UnauthorizedError(
        'Mật khẩu hiện tại không chính xác' +
        (remaining > 0 ? ` (Còn ${remaining} lần thử trước khi bị tạm khóa)` : ' (Tài khoản đã bị tạm khóa 15 phút)')
      );
    }

    await this.redis.clearFailedPasswordAttempts(id);

    if (oldPass === newPass) {
      throw new BadRequestError('Mật khẩu mới không được trùng với mật khẩu cũ');
    }

    this.validatePasswordStrength(newPass);

    const passwordHash = await bcrypt.hash(newPass, 10);
    await this.userRepo.update(id, { passwordHash, passwordAutoGenerated: false });

    // Gửi email cảnh báo bảo mật
    try {
      await axios.post(
        `${config.notificationServiceUrl}/internal/send-password-changed-alert`,
        { toEmail: user.email },
        {
          headers: { Authorization: `Bearer ${getServiceToken('user-service', config.jwtSecret)}` },
          timeout: 5000,
        }
      ).catch((err) => console.warn('Failed to send security alert email:', err.message));
    } catch (err: any) {
      console.warn('Failed to send security alert:', err?.message);
    }

    this.redis.publishUserUpdated(id, user.email);
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
      await retryWithBackoff(async () => {
        if (!notificationCircuit.canRequest()) {
          throw new Error('Notification service temporarily unavailable');
        }
        try {
          const response = await axios.post(
            `${config.notificationServiceUrl}/internal/send-email-change`,
            { toEmail: normalizedEmail, code },
            {
              headers: { 'Authorization': `Bearer ${getServiceToken('user-service', config.jwtSecret)}` },
              timeout: 5000,
            }
          );
          notificationCircuit.recordSuccess();
          return response;
        } catch (err: any) {
          if (err?.response?.status >= 500 || err?.code === 'ECONNABORTED' || err?.code === 'ECONNREFUSED') {
            notificationCircuit.recordFailure();
          }
          throw err;
        }
      }, 2, 500);
    } catch (e: any) {
      console.error('[UserService] Failed to send email change OTP:', e.response?.status, e.response?.data || e.message);
      throw new Error('Không thể gửi email, vui lòng thử lại sau');
    }
  }

  async verifyAndChangeEmail(id: string, newEmail: string, code: string): Promise<void> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const normalizedEmail = newEmail.trim().toLowerCase();
    const storedCode = await this.redis.getEmailVerificationCode(normalizedEmail);
    
    if (!storedCode || storedCode !== code) {
      throw new BadRequestError('Mã xác thực không hợp lệ hoặc đã hết hạn');
    }

    const existing = await this.userRepo.findByEmail(normalizedEmail);
    if (existing && existing.id !== id) {
      throw new BadRequestError('Email nay da duoc su dung');
    }

    await this.userRepo.update(id, { email: normalizedEmail });
    await this.redis.deleteEmailVerificationCode(normalizedEmail);
    this.redis.publishUserUpdated(id, normalizedEmail);
  }

  private toPublic(user: any, hasFace: boolean = false): UserPublicDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      studentCode: user.studentCode,
      className: user.className,
      course: user.course ?? null,
      permanentAddress: user.permanentAddress ?? null,
      identityNumber: user.identityNumber,
      phone: user.phone,
      cardNumber: user.cardNumber,
      issueDate: user.issueDate,
      membershipExpiry: user.membershipExpiry,
      status: user.status,
      currentStatus: user.currentStatus,
      lastEntryAt: user.lastEntryAt,
      lastEntryCamera: user.lastEntryCamera,
      avatarUrl: user.avatarUrl,
      suspendedReason: user.suspendedReason,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      passwordAutoGenerated: user.passwordAutoGenerated ?? true,
      hasFace: hasFace,
    };
  }
}
