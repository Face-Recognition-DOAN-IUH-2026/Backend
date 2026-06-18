import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { AppDataSource } from './data-source';
import { User } from './entities/User.entity';

async function seed() {
  try {
    await AppDataSource.initialize();
    console.log('[seed] Database connected');

    const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
    const adminPassword = String(process.env.DEFAULT_ADMIN_PASSWORD || 'password123');
    const adminFullName = process.env.DEFAULT_ADMIN_FULL_NAME || 'System Administrator';

    const repo = AppDataSource.getRepository(User);
    const existing = await repo.findOne({ where: { email: adminEmail } });

    if (existing) {
      console.log(`[seed] Admin account already exists: ${adminEmail}`);
    } else {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      await repo.save(repo.create({
        email: adminEmail,
        passwordHash,
        fullName: adminFullName,
        role: 'admin',
        status: 'active',
      }));
      console.log(`[seed] Created admin account: ${adminEmail}`);
    }

    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('[seed] Failed:', error);
    process.exit(1);
  }
}

seed();
