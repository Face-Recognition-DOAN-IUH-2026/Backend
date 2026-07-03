import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import scheduleRoutes from './routes/schedule.routes';
import scheduleInternalRoutes from './routes/schedule-internal.routes';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { errorHandler, setupProcessErrorHandlers } from '../shared/error-handler';
import { startUserEventSubscriber } from './subscribers/UserEventSubscriber';
import { auditContextMiddleware } from './middlewares/auditContext';

const app = express();

app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true }));
app.use(express.json());
app.use(auditContextMiddleware);

app.use('/schedules/internal', scheduleInternalRoutes);
app.use('/schedules', scheduleRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'schedule-service' }));

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
    await startUserEventSubscriber();
    setupProcessErrorHandlers();
    const server = app.listen(config.port, () => {
      console.log(`Schedule service running on port ${config.port}`);
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
    console.error('Failed to start schedule-service:', error);
    process.exit(1);
  }
}

start();
