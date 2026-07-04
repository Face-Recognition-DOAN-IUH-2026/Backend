import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { swaggerSpec } from './config/swagger';
import { AppDataSource } from './data-source';
import borrowRoutes from './routes/borrow.routes';
import borrowInternalRoutes from './routes/borrow-internal.routes';
import libraryRoutes from './routes/library.routes';
import { errorHandler, setupProcessErrorHandlers } from '../../shared/error-handler';
import { amqpClient } from './clients/AmqpClient';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use('/borrow/internal', borrowInternalRoutes);
app.use('/borrow', borrowRoutes);
app.use('/library', libraryRoutes);

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', service: config.serviceName });
});

app.get('/ready', async (_req, res) => {
  try {
    await AppDataSource.query('SELECT 1');
    res.json({ status: 'ok', service: config.serviceName, db_ok: true });
  } catch {
    res.status(503).json({ status: 'degraded', service: config.serviceName, db_ok: false });
  }
});

if (config.nodeEnv !== 'production') {
  app.get('/api-docs/swagger.json', (_req, res) => {
    res.json(swaggerSpec);
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

app.use(errorHandler);

async function start() {
  try {
    await AppDataSource.initialize();
    setupProcessErrorHandlers();
    await amqpClient.connect().catch((e) => console.error('[AMQP] Init failed:', e.message));
    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log(`Borrow service running on port ${config.port}`);
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
    console.error('Failed to start borrow-service:', error);
    process.exit(1);
  }
}

start();
