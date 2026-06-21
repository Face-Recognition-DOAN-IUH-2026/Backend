import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import scheduleRoutes from './routes/schedule.routes';
import scheduleInternalRoutes from './routes/schedule-internal.routes';
import { errorHandler } from './middlewares/errorHandler';
import { startUserEventSubscriber } from './subscribers/UserEventSubscriber';

const app = express();

app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true }));
app.use(express.json());

app.use('/schedules', scheduleInternalRoutes);
app.use('/schedules', scheduleRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'schedule-service' }));

app.use(errorHandler);

async function start() {
  try {
    await AppDataSource.initialize();
    await startUserEventSubscriber();
    app.listen(config.port, () => {
      console.log(`Schedule service running on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start schedule-service:', error);
    process.exit(1);
  }
}

start();
