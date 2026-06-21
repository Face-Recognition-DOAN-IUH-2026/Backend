import { randomUUID } from 'crypto';
import { Response } from 'express';
import Redis from 'ioredis';
import { WebSocket } from 'ws';
import { config } from '../config';
import { Notification } from '../entities/Notification';

const CHANNEL = 'notifications.events';

export class NotificationHub {
  private sseClients = new Map<string, Set<Response>>();
  private wsClients = new Map<string, Set<WebSocket>>();
  private instanceId = randomUUID();
  private publisher?: Redis;
  private subscriber?: Redis;

  async connectRedis() {
    if (!config.redisUrl) return;
    this.publisher = new Redis(config.redisUrl);
    this.subscriber = new Redis(config.redisUrl);
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', (_channel, raw) => {
      try {
        const message = JSON.parse(raw);
        if (message.originId === this.instanceId) return;
        this.pushToUser(message.userId, message.notification);
      } catch {
        // Ignore malformed messages
      }
    });
  }

  addSseClient(userId: string, res: Response) {
    if (!this.sseClients.has(userId)) {
      this.sseClients.set(userId, new Set());
    }
    this.sseClients.get(userId)!.add(res);
    res.write(': connected\n\n');
    const interval = setInterval(() => res.write(': keepalive\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(interval);
      this.sseClients.get(userId)?.delete(res);
      if (this.sseClients.get(userId)?.size === 0) {
        this.sseClients.delete(userId);
      }
    });
  }

  addWsClient(userId: string, ws: WebSocket) {
    if (!this.wsClients.has(userId)) {
      this.wsClients.set(userId, new Set());
    }
    this.wsClients.get(userId)!.add(ws);
    ws.on('close', () => {
      this.wsClients.get(userId)?.delete(ws);
      if (this.wsClients.get(userId)?.size === 0) {
        this.wsClients.delete(userId);
      }
    });
    ws.on('error', () => {
      this.wsClients.get(userId)?.delete(ws);
    });
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
  }

  async pushToUser(userId: string, notification: Notification) {
    // Local push
    const payload = JSON.stringify({ event: 'notification_created', data: notification });

    const sseClients = this.sseClients.get(userId);
    if (sseClients) {
      for (const client of sseClients) {
        client.write(`event: notification\n`);
        client.write(`data: ${payload}\n\n`);
      }
    }

    const wsClients = this.wsClients.get(userId);
    if (wsClients) {
      for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    }
  }

  async publish(userId: string, notification: Notification) {
    this.pushToUser(userId, notification);
    if (this.publisher) {
      await this.publisher.publish(
        CHANNEL,
        JSON.stringify({ originId: this.instanceId, userId, notification })
      );
    }
  }
}

export const notificationHub = new NotificationHub();
