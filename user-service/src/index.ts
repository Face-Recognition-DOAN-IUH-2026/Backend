import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { AppDataSource } from './data-source';
import { authRoutes, userRoutes, patronRoutes, internalRoutes, permissionRoutes } from './routes';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { errorHandler, setupProcessErrorHandlers } from '../../shared/error-handler';

const app = express();

app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'user-service' });
});

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/patrons', patronRoutes);
app.use('/internal', internalRoutes);
app.use('/permissions', permissionRoutes);

if (config.nodeEnv !== 'production') {
  app.get('/api-docs/swagger.json', (_req, res) => {
    res.json(swaggerSpec);
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

app.use(errorHandler);

async function start() {
  try {
    setupProcessErrorHandlers();
    await AppDataSource.initialize();
    console.log('Database initialized via TypeORM');

    const { startAmqpSubscriber } = require('./subscribers/AmqpSubscriber');
    startAmqpSubscriber().catch((e: any) => console.error('[AMQP] Subscriber error:', e.message));

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
