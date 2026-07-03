"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const data_source_1 = require("../data-source");
const User_entity_1 = require("../entities/User.entity");
const CloudinaryService_1 = require("./CloudinaryService");
const errors_1 = require("../errors");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const shared_1 = require("../../../shared");
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const AccessServiceClient_1 = require("../clients/AccessServiceClient");
class UserService {
    constructor(userRepo, patronRepo, redis) {
        this.userRepo = userRepo;
        this.patronRepo = patronRepo;
        this.redis = redis;
    }
    async getAllUsers() {
        const [users, total] = await this.userRepo.findAll();
        return {
            users: users.map(this.toPublic),
            total,
        };
    }
    async getUserById(id) {
        const user = await this.userRepo.findById(id);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        return {
            id: user.id,
            email: user.email,
            full_name: user.fullName,
            role: user.role,
            student_code: user.studentCode,
            class_name: user.className,
            course: user.course,
            identity_number: user.identityNumber,
            phone: user.phone,
            permanent_address: user.permanentAddress,
            card_number: user.cardNumber,
            issue_date: user.issueDate,
            membership_expiry: user.membershipExpiry,
            status: user.status,
            current_status: user.currentStatus,
            last_entry_at: user.lastEntryAt,
            last_entry_camera: user.lastEntryCamera,
            avatar_url: user.avatarUrl,
            suspended_reason: user.suspendedReason,
            created_at: user.createdAt,
        };
    }
    async updateAvatar(userId, buffer, mimeType) {
        const user = await this.userRepo.findById(userId);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        const cloudinarySvc = new CloudinaryService_1.CloudinaryService();
        const avatarUrl = await cloudinarySvc.uploadAvatar(userId, buffer, mimeType);
        await this.userRepo.update(userId, { avatarUrl });
        return avatarUrl;
    }
    async deleteAvatar(userId) {
        const user = await this.userRepo.findById(userId);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        const cloudinarySvc = new CloudinaryService_1.CloudinaryService();
        await cloudinarySvc.deleteAvatar(userId);
        await this.userRepo.update(userId, { avatarUrl: null });
    }
    async updateAccessStatus(id, currentStatus, cameraId) {
        const user = await this.userRepo.findById(id);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        try {
            await AccessServiceClient_1.accessServiceClient.setPatronStatus(id, currentStatus, cameraId || undefined);
        }
        catch (err) {
            console.error('[UserService] Failed to sync status to access-service:', err);
        }
        const updates = { currentStatus };
        if (currentStatus === 'inside') {
            updates.lastEntryAt = new Date();
            updates.lastEntryCamera = cameraId ?? null;
        }
        const updated = await this.userRepo.update(id, updates);
        return this.getUserById(updated.id);
    }
    async deleteUser(id) {
        const user = await this.userRepo.findById(id);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        const queryRunner = data_source_1.AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            if (user.status === 'deleted' || user.role === 'admin' || user.role === 'staff') {
                // Hard delete for already deleted users, or for admin/staff immediately
                await queryRunner.manager.delete(User_entity_1.User, id);
                await this.redis.publishUserDeleted(id, user.email);
                await queryRunner.commitTransaction();
                return { deleted: true, id, soft: false };
            }
            else {
                // Soft delete for active users
                await queryRunner.manager.update(User_entity_1.User, id, { status: 'deleted' });
                await this.redis.publishUserDeleted(id, user.email);
                await queryRunner.commitTransaction();
                return { deleted: true, id, soft: true };
            }
        }
        catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        }
        finally {
            await queryRunner.release();
        }
    }
    async restoreUser(id) {
        const user = await this.userRepo.findById(id);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        if (user.status !== 'deleted') {
            throw new errors_1.BadRequestError('User is not deleted');
        }
        await this.userRepo.update(id, { status: 'active' });
        this.redis.publishUserUpdated(id, user.email);
        return this.getUserById(id);
    }
    async adminUpdateUser(id, updates) {
        const user = await this.userRepo.findById(id);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        const updateData = {};
        if (updates.fullName !== undefined)
            updateData.fullName = updates.fullName || null;
        if (updates.phone !== undefined)
            updateData.phone = updates.phone || null;
        if (updates.studentCode !== undefined)
            updateData.studentCode = updates.studentCode || null;
        if (updates.className !== undefined)
            updateData.className = updates.className || null;
        if (updates.identityNumber !== undefined)
            updateData.identityNumber = updates.identityNumber || null;
        if (updates.course !== undefined)
            updateData.course = updates.course || null;
        if (updates.permanentAddress !== undefined)
            updateData.permanentAddress = updates.permanentAddress || null;
        if (updates.cardNumber !== undefined)
            updateData.cardNumber = updates.cardNumber || null;
        if (updates.issueDate !== undefined)
            updateData.issueDate = updates.issueDate || null;
        if (updates.membershipExpiry !== undefined)
            updateData.membershipExpiry = updates.membershipExpiry || null;
        if (updates.role !== undefined) {
            if (!['patron', 'staff', 'admin', 'user'].includes(updates.role)) {
                throw new errors_1.BadRequestError('Vai trò không hợp lệ');
            }
            updateData.role = updates.role;
        }
        if (updates.status !== undefined) {
            if (!['active', 'suspended', 'inactive'].includes(updates.status)) {
                throw new errors_1.BadRequestError('Trạng thái không hợp lệ');
            }
            updateData.status = updates.status;
            if (updates.status === 'suspended' && updates.suspendedReason) {
                updateData.suspendedReason = updates.suspendedReason;
            }
            else if (updates.status === 'active') {
                updateData.suspendedReason = null;
            }
        }
        if (updates.avatarUrl !== undefined)
            updateData.avatarUrl = updates.avatarUrl || null;
        if (updateData.studentCode !== undefined && updateData.studentCode !== null) {
            const existing = await this.userRepo.findByStudentCode(updateData.studentCode);
            if (existing && existing.id !== id) {
                throw new errors_1.BadRequestError('Mã sinh viên đã được sử dụng');
            }
        }
        if (updateData.cardNumber !== undefined && updateData.cardNumber !== null) {
            const existing = await this.userRepo.findByCardNumber(updateData.cardNumber);
            if (existing && existing.id !== id) {
                throw new errors_1.BadRequestError('Số thẻ đã được sử dụng');
            }
        }
        await this.userRepo.update(id, updateData);
        this.redis.publishUserUpdated(id, user.email);
        return this.getUserById(id);
    }
    async updateProfile(id, updates) {
        const user = await this.userRepo.findById(id);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        const updateData = {};
        if (updates.fullName !== undefined)
            updateData.fullName = updates.fullName;
        if (updates.phone !== undefined)
            updateData.phone = updates.phone;
        if (updates.permanentAddress !== undefined)
            updateData.permanentAddress = updates.permanentAddress;
        await this.userRepo.update(id, updateData);
        this.redis.publishUserUpdated(id, user.email);
        const updatedUser = await this.userRepo.findById(id);
        return this.toPublic(updatedUser);
    }
    async changePassword(id, oldPass, newPass) {
        const user = await this.userRepo.findById(id);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        const isMatch = await bcryptjs_1.default.compare(oldPass, user.passwordHash);
        if (!isMatch)
            throw new errors_1.UnauthorizedError('Mat khau hien tai khong dung');
        const passwordHash = await bcryptjs_1.default.hash(newPass, 10);
        await this.userRepo.update(id, { passwordHash });
    }
    async requestEmailChangeOtp(id, newEmail) {
        const user = await this.userRepo.findById(id);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        const normalizedEmail = newEmail.trim().toLowerCase();
        const existing = await this.userRepo.findByEmail(normalizedEmail);
        if (existing && existing.id !== id) {
            throw new errors_1.BadRequestError('Email nay da duoc su dung');
        }
        const code = crypto_1.default.randomInt(100000, 999999).toString();
        // Reusing the password reset or verification code logic in Redis, or create a new one.
        // We'll create a new redis method or use a generic one if possible, but wait, RedisService might not have setEmailChangeCode.
        // Let's use setEmailVerificationCode but with the newEmail.
        await this.redis.setEmailVerificationCode(normalizedEmail, code);
        try {
            await axios_1.default.post(`${config_1.config.notificationServiceUrl}/internal/send-email-change`, { toEmail: normalizedEmail, code }, { headers: { 'Authorization': `Bearer ${(0, shared_1.getServiceToken)('user-service', config_1.config.jwtSecret)}` } });
        }
        catch (e) {
            console.error('[UserService] Failed to send email change OTP:', e.response?.status, e.response?.data || e.message);
            throw new Error('Khong the gui email, vui long thu lai sau');
        }
    }
    async verifyAndChangeEmail(id, newEmail, code) {
        const user = await this.userRepo.findById(id);
        if (!user)
            throw new errors_1.NotFoundError('User not found');
        const normalizedEmail = newEmail.trim().toLowerCase();
        const storedCode = await this.redis.getEmailVerificationCode(normalizedEmail);
        if (!storedCode || storedCode !== code) {
            throw new errors_1.BadRequestError('Ma xac thuc khong hop le hoac da het han');
        }
        const existing = await this.userRepo.findByEmail(normalizedEmail);
        if (existing && existing.id !== id) {
            throw new errors_1.BadRequestError('Email nay da duoc su dung');
        }
        await this.userRepo.update(id, { email: normalizedEmail });
        await this.redis.deleteEmailVerificationCode(normalizedEmail);
        this.redis.publishUserUpdated(id, normalizedEmail);
    }
    toPublic(user) {
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
exports.UserService = UserService;
