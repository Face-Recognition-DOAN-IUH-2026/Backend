"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRepository = void 0;
const typeorm_1 = require("typeorm");
class UserRepository {
    constructor(repo) {
        this.repo = repo;
    }
    async findById(id) {
        return this.repo.findOneBy({ id });
    }
    async findByEmail(email) {
        return this.repo.findOneBy({ email });
    }
    async findByStudentCode(code) {
        return this.repo.findOneBy({ studentCode: code });
    }
    async findByCardNumber(card) {
        return this.repo.findOneBy({ cardNumber: card });
    }
    async findAll(skip = 0, limit = 200) {
        return this.repo.findAndCount({
            skip,
            take: limit,
            order: { createdAt: 'DESC' },
        });
    }
    async findStaff(ids) {
        return this.repo.find({
            where: {
                role: (0, typeorm_1.In)(['staff', 'admin']),
                status: 'active',
                ...(ids?.length ? { id: (0, typeorm_1.In)(ids) } : {}),
            },
            order: { fullName: 'ASC', email: 'ASC' },
        });
    }
    async create(data) {
        const user = this.repo.create(data);
        return this.repo.save(user);
    }
    async update(id, data) {
        const result = await this.repo.update(id, data);
        if (result.affected === 0)
            return null;
        return this.findById(id);
    }
    async delete(id) {
        const result = await this.repo.delete(id);
        return (result.affected ?? 0) > 0;
    }
}
exports.UserRepository = UserRepository;
