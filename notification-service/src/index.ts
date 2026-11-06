import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config';
import { AppDataSource } from './data-source';
import notificationRoutes from './routes/notification.routes';
import internalRoutes from './routes/internal.routes';
import { errorHandler, setupProcessErrorHandlers } from '../../shared/error-handler';
import { decodeToken } from '../../shared/auth';
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
    setupProcessErrorHandlers();
    await AppDataSource.initialize();
    console.log('Database connected');
    await notificationHub.connectBroker();
    await startUserEventSubscriber();
    
    const { startAmqpSubscriber } = require('./subscribers/AmqpSubscriber');
    startAmqpSubscriber().catch((e: any) => console.error('[AMQP] Subscriber error:', e.message));

    const server = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      if (url.pathname !== '/notifications/ws') {
        socket.destroy();
        return;
      }
      const authHeader = request.headers.authorization?.replace(/^Bearer\s+/i, '');
      const cookieToken = request.headers.cookie?.match(/(?:^|;\s*)access_token=([^;]+)/)?.[1];
      const token = authHeader || cookieToken || url.searchParams.get('token');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      try {
        const user = decodeToken(token, {
          jwtSecret: config.jwtSecret,
          jwtIssuer: config.jwtIssuer,
          jwtAudience: config.jwtAudience,
        });
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
    console.error('Failed to start notification-service:', error);
    process.exit(1);
  }
}

start();
