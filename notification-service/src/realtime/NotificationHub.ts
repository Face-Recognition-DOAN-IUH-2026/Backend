import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { WebSocket } from 'ws';
import { amqpClient } from '../clients/AmqpClient';
import { config } from '../config';
import { Notification } from '../entities/Notification';
import { pushNotificationService } from '../services/PushNotificationService';

const EXCHANGE = 'notifications.realtime.fanout';

function signPayload(payload: object, secret: string): string {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

export class NotificationHub {
  private sseClients = new Map<string, Set<Response>>();
  private wsClients = new Map<string, Set<WebSocket>>();
  private instanceId = randomUUID();

  async connectBroker() {
    try {
      await amqpClient.connect();
      await amqpClient.subscribeFanout(EXCHANGE, (message: any) => {
        if (message.originId === this.instanceId) return;
        if (message.signature && config.serviceJwtSecret) {
          const { signature, ...rest } = message;
          const expected = signPayload(rest, config.serviceJwtSecret);
          try {
            if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
              console.warn('[NotificationHub] Invalid signature, ignoring event');
              return;
            }
          } catch {
            console.warn('[NotificationHub] Signature verification failed, ignoring event');
            return;
          }
        }
        this.pushToUser(message.userId, message.notification);
      });
      console.log('[NotificationHub] Connected to RabbitMQ fanout:', EXCHANGE);
    } catch (err: any) {
      console.error('[NotificationHub] RabbitMQ connection failed:', err.message);
    }
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
    const payload = JSON.stringify({ event: 'notification_created', data: notification });

    const sseClients = this.sseClients.get(userId);
    if (sseClients) {
      for (const client of sseClients) {
        try {
          client.write(`event: notification\n`);
          client.write(`data: ${payload}\n\n`);
        } catch (err) {
          console.error('[NotificationHub] SSE write failed:', err);
        }
      }
    }

    const wsClients = this.wsClients.get(userId);
    if (wsClients) {
      for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(payload);
          } catch (err) {
            console.error('[NotificationHub] WS send failed:', err);
          }
        }
      }
    }

    pushNotificationService.sendToUser(userId, {
      title: notification.title,
      body: notification.body,
      data: notification.data || undefined,
    }).catch((err) => {
      console.error('[NotificationHub] Push notification failed:', err);
    });
  }

  async publish(userId: string, notification: Notification) {
    await this.pushToUser(userId, notification);
    const body = {
      originId: this.instanceId,
      userId,
      notification,
      timestamp: new Date().toISOString(),
    };
    const signature = config.serviceJwtSecret ? signPayload(body, config.serviceJwtSecret) : '';
    await amqpClient.publishFanout(EXCHANGE, { ...body, signature });
  }

  async broadcastHazard(hazardData: any) {
    const payload = JSON.stringify({
      event: 'hazard_alert',
      type: 'hazard_fire',
      data: hazardData,
      timestamp: new Date().toISOString(),
    });

    // 1. Broadcast tới tất cả WebSocket clients đang kết nối
    for (const [userId, wsSet] of this.wsClients.entries()) {
      for (const ws of wsSet) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(payload);
          } catch (err) {
            console.error('[NotificationHub] broadcastHazard WS send failed:', err);
          }
        }
      }
    }

    // 2. Broadcast tới tất cả SSE clients đang kết nối
    for (const [userId, sseSet] of this.sseClients.entries()) {
      for (const client of sseSet) {
        try {
          client.write(`event: hazard_alert\n`);
          client.write(`data: ${payload}\n\n`);
        } catch (err) {
          console.error('[NotificationHub] broadcastHazard SSE write failed:', err);
        }
      }
    }

    // 3. Gửi Push Notification tới toàn bộ thiết bị điện thoại qua Expo Push Service
    await pushNotificationService.sendHazardBroadcast(hazardData);
  }
}

export const notificationHub = new NotificationHub();
