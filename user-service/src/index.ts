import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import { authRoutes, userRoutes, patronRoutes, internalRoutes } from './routes';
import { errorHandler } from './middlewares';
import bcrypt from 'bcryptjs';
import { User } from './entities/User.entity';

const app = express();

app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'user-service' });
});

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/patrons', patronRoutes);
app.use('/internal', internalRoutes);

app.use(errorHandler);

async function start() {
  try {
    await AppDataSource.initialize();
    console.log('Database initialized via TypeORM');

    // Dev bootstrap: create an initial admin if none exists.
    // This is important because /auth/register requires admin/staff already.
    if (config.nodeEnv !== 'production') {
      const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
      const adminPassword = String(process.env.DEFAULT_ADMIN_PASSWORD || 'password123');
      const repo = AppDataSource.getRepository(User);
      const existingAdmin = await repo.findOne({ where: { email: adminEmail } });
      if (!existingAdmin) {
        const passwordHash = await bcrypt.hash(adminPassword, 10);
        await repo.save(repo.create({
          email: adminEmail,
          passwordHash,
          fullName: 'Admin',
          role: 'admin',
          status: 'active',
        }));
        console.log(`[bootstrap] Created default admin: ${adminEmail}`);
      }
    }

    app.listen(config.port, () => {
      console.log(`User service running on port ${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();
