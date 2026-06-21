import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config';
import { AppDataSource } from './data-source';
import notificationRoutes from './routes/notification.routes';
import internalRoutes from './routes/internal.routes';
import { errorHandler } from './middlewares/errorHandler';
import { decodeToken } from './middlewares/auth';
import { notificationHub } from './realtime/NotificationHub';
import { startUserEventSubscriber } from './subscribers/UserEventSubscriber';

const app = express();

app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notification-service' }));
app.use('/notifications', notificationRoutes);
app.use('/internal', internalRoutes);

app.use(errorHandler);

async function start() {
  try {
    await AppDataSource.initialize();
    console.log('Database connected, running migrations...');
    await AppDataSource.runMigrations();
    console.log('Migrations completed');
    await notificationHub.connectRedis();
    await startUserEventSubscriber();

    const server = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      if (url.pathname !== '/notifications/ws') {
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
        const user = decodeToken(token);
        wss.handleUpgrade(request, socket, head, (ws) => {
          notificationHub.addWsClient(user.userId, ws);
        });
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    });

    server.listen(config.port, () => {
      console.log(`Notification service running on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start notification-service:', error);
    process.exit(1);
  }
}

start();
