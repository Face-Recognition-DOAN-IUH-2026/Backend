import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import { authRoutes, userRoutes, patronRoutes } from './routes';
import { errorHandler } from './middlewares';

const app = express();

app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'user-service' });
});

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/patrons', patronRoutes);

app.use(errorHandler);

async function start() {
  try {
    await AppDataSource.initialize();
    console.log('Database initialized via TypeORM');

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
