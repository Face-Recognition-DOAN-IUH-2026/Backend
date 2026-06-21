import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import aiRoutes from './routes/ai.routes';
import { errorHandler } from './middlewares/errorHandler';
import { auth } from './middlewares/auth';

const app = express();

app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/ai/health', (_req, res) => res.json({ status: 'ok', service: 'ai-service', mockMode: config.ai.mockMode }));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ai-service' }));
app.use('/ai', auth, aiRoutes);
app.use(errorHandler);

async function start() {
  try {
    await AppDataSource.initialize();
    const server = app.listen(config.port, () => {
      console.log(`AI service running on port ${config.port}`);
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
    console.error('Failed to start ai-service:', error);
    process.exit(1);
  }
}

start();
