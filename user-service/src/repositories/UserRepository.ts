import { In, Repository } from 'typeorm';
import { User } from '../entities/User.entity';

export class UserRepository {
  constructor(protected repo: Repository<User>) {}

  async findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email });
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return this.repo.findBy({ id: In(ids) });
  }

  async findByStudentCode(code: string): Promise<User | null> {
    return this.repo.findOneBy({ studentCode: code });
  }

  async findByCardNumber(card: string): Promise<User | null> {
    return this.repo.findOneBy({ cardNumber: card });
  }

  async findAll(skip = 0, limit = 200): Promise<[User[], number]> {
    return this.repo.findAndCount({
      skip,
      take: limit,
      order: { createdAt: 'DESC' },
    });
  }

  async findStaff(ids?: string[]): Promise<User[]> {
    return this.repo.find({
      where: {
        role: In(['staff', 'admin']),
        status: 'active',
        ...(ids?.length ? { id: In(ids) } : {}),
      },
      order: { fullName: 'ASC', email: 'ASC' },
    });
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.repo.create(data);
    return this.repo.save(user);
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    const result = await this.repo.update(id, data);
    if (result.affected === 0) return null;
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.repo.delete(id);
    return (result.affected ?? 0) > 0;
  }
}
