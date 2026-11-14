import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import borrowRoutes from './routes/borrow.routes';
import borrowInternalRoutes from './routes/borrow-internal.routes';
import libraryRoutes from './routes/library.routes';
import bookRoutes from './routes/book.routes';
import staffRoutes from './routes/staff.routes';
import waitlistRoutes from './routes/waitlist.routes';
import adminSettingsRoutes from './routes/admin-settings.routes';
import paymentRoutes from './routes/payment.routes';
import sepayRoutes from './routes/sepay.routes';
import { errorHandler, setupProcessErrorHandlers } from '../../shared/error-handler';
import { amqpClient } from './clients/AmqpClient';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

app.use('/borrow/internal', borrowInternalRoutes);
app.use('/borrow/waitlist', waitlistRoutes);
app.use('/borrow/payments', paymentRoutes);
app.use('/borrow/sepay', sepayRoutes);
app.use('/borrow', borrowRoutes);
app.use('/borrow', bookRoutes);
app.use('/borrow', staffRoutes);
app.use('/library', libraryRoutes);
app.use('/borrow/admin', adminSettingsRoutes);

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

app.use(errorHandler);

async function start() {
  try {
    await AppDataSource.initialize();
    setupProcessErrorHandlers();
    await amqpClient.connect().catch((e: any) => console.error('[AMQP] Init failed:', e.message));
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
