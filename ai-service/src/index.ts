import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import aiRoutes from './routes/ai.routes';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/ai/health', (_req, res) => res.json({ status: 'ok', service: 'ai-service', mockMode: config.ai.mockMode }));
app.use('/ai', aiRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ai-service' }));
app.use(errorHandler);

async function start() {
  try {
    await AppDataSource.initialize();
    app.listen(config.port, () => {
      console.log(`AI service running on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start ai-service:', error);
    process.exit(1);
  }
}

start();
