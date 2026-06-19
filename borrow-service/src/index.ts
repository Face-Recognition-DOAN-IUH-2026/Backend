import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import borrowRoutes from './routes/borrow.routes';
import libraryRoutes from './routes/library.routes';
import { errorHandler } from './middlewares/errorHandler';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
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

app.use(errorHandler);

async function start() {
  try {
    await AppDataSource.initialize();
    app.listen(config.port, '0.0.0.0', () => {
      console.log(`Borrow service running on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start borrow-service:', error);
    process.exit(1);
  }
}

start();
