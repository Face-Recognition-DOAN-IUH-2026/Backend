import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import { authRoutes, userRoutes, patronRoutes, internalRoutes } from './routes';
import { errorHandler, setupProcessErrorHandlers } from '../shared/error-handler';


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

    setupProcessErrorHandlers();
    const server = app.listen(config.port, () => {
      console.log(`User service running on port ${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });

    const shutdown = async () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(async () => {
        await AppDataSource.destroy();
        console.log('Database connections closed');
        process.exit(0);
      });
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();
