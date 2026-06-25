import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import automationRoutes from './routes/automation.routes';
import internalRoutes from './routes/internal.routes';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { errorHandler, setupProcessErrorHandlers } from '../shared/error-handler';
import { cronScheduler } from './scheduler/CronScheduler';
import { eventBus } from './events/EventBus';

const app = express();

app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'automation-service' }));
app.use('/automation', automationRoutes);
app.use('/internal', internalRoutes);

if (config.nodeEnv !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

app.use(errorHandler);

async function start() {
  try {
    await AppDataSource.initialize();
    console.log('Database connected, running migrations...');
    await AppDataSource.runMigrations();
    console.log('Migrations completed');

    // Connect event bus
    await eventBus.connect();

    // Start cron scheduler
    await cronScheduler.start();

    setupProcessErrorHandlers();
    app.listen(config.port, () => {
      console.log(`Automation service running on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start automation-service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await cronScheduler.stop();
  process.exit(0);
});

start();
