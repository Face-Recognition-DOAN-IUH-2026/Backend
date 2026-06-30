"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatronRepository = void 0;
const UserRepository_1 = require("./UserRepository");
class PatronRepository extends UserRepository_1.UserRepository {
    async findPatrons(options) {
        const qb = this.repo
            .createQueryBuilder('user')
            .where('user.role = :role', { role: 'patron' });
        if (options?.query) {
            qb.andWhere('(user.fullName ILIKE :q OR user.studentCode ILIKE :q OR user.cardNumber ILIKE :q)', { q: `%${options.query}%` });
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
    async getActivePatrons() {
        return this.repo.find({
            where: {
                role: 'patron',
                currentStatus: 'inside',
                status: 'active',
            },
        });
    }
    async countActivePatrons() {
        return this.repo.count({ where: { role: 'patron', status: 'active' } });
    }
    async countActiveInside() {
        return this.repo.count({
            where: { role: 'patron', currentStatus: 'inside', status: 'active' },
        });
    }
    async updateCurrentStatus(id, status, lastEntryAt, lastEntryCamera) {
        await this.repo.update(id, {
            currentStatus: status,
            lastEntryAt: lastEntryAt ?? null,
            lastEntryCamera: lastEntryCamera ?? null,
        });
    }
}
exports.PatronRepository = PatronRepository;
