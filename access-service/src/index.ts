import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { AppDataSource } from './data-source';
import accessRoutes from './routes/access.routes';
import internalRoutes from './routes/internal.routes';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { errorHandler, setupProcessErrorHandlers } from '../shared/error-handler';
import { decodeToken } from './middlewares/auth';
import { realtimeHub } from './realtime/RealtimeHub';
import { startUserEventSubscriber } from './subscribers/UserEventSubscriber';

const app = express();

app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use('/access', accessRoutes);
app.use('/internal', internalRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'access-service' }));

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
    await realtimeHub.connectRedis();
    await startUserEventSubscriber();

    const server = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      if (url.pathname !== '/access/ws') {
        socket.destroy();
        return;
      }
      const token = url.searchParams.get('token') || request.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      try {
        decodeToken(token);
        wss.handleUpgrade(request, socket, head, (ws) => realtimeHub.addWsClient(ws));
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    });

    setupProcessErrorHandlers();
    server.listen(config.port, () => {
      console.log(`Access service running on port ${config.port}`);
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
    console.error('Failed to start access-service:', error);
    process.exit(1);
  }
}

start();
