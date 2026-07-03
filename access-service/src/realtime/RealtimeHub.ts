import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { WebSocket } from 'ws';
import { amqpClient } from '../clients/AmqpClient';
import { config } from '../config';
import { AccessRealtimeEvent, FaceResultEvent } from '../contracts';

const EXCHANGE = 'access.realtime.fanout';

function signPayload(payload: object, secret: string): string {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

export class RealtimeHub {
  private sseClients = new Set<Response>();
  private wsClients = new Set<WebSocket>();
  private instanceId = randomUUID();

  async connectBroker() {
    try {
      await amqpClient.connect();
      await amqpClient.subscribeFanout(EXCHANGE, (message) => {
        if (message.originId === this.instanceId) return;
        if (message.signature && config.serviceJwtSecret) {
          const { signature, ...rest } = message;
          const expected = signPayload(rest, config.serviceJwtSecret);
          try {
            if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
              console.warn('[RealtimeHub] Invalid signature, ignoring event');
              return;
            }
          } catch {
            console.warn('[RealtimeHub] Signature verification failed, ignoring event');
            return;
          }
        }
        this.broadcastLocal(message.event as AccessRealtimeEvent);
      });
      console.log('[RealtimeHub] Connected to RabbitMQ fanout:', EXCHANGE);
    } catch (err: any) {
      console.error('[RealtimeHub] RabbitMQ connection failed:', err.message);
    }
  }

  addSseClient(res: Response) {
    this.sseClients.add(res);
    res.write(': connected\n\n');
    const interval = setInterval(() => res.write(': keepalive\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(interval);
      this.sseClients.delete(res);
    });
  }

  addWsClient(ws: WebSocket) {
    this.wsClients.add(ws);
    ws.on('close', () => this.wsClients.delete(ws));
    ws.on('error', () => this.wsClients.delete(ws));
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
  }

  async publish(event: AccessRealtimeEvent) {
    this.broadcastLocal(event);
    const body = {
      originId: this.instanceId,
      event,
      timestamp: new Date().toISOString(),
    };
    const signature = config.serviceJwtSecret ? signPayload(body, config.serviceJwtSecret) : '';
    await amqpClient.publishFanout(EXCHANGE, { ...body, signature });
  }

  private broadcastLocal(event: AccessRealtimeEvent) {
    const payload = JSON.stringify(event);
    for (const client of this.sseClients) {
      client.write(`event: camera_event\n`);
      client.write(`data: ${payload}\n\n`);
    }
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event: 'camera_event', data: event }));
      }
    }
  }

  broadcastFaceResult(event: FaceResultEvent) {
    const payload = JSON.stringify(event);
    for (const client of this.sseClients) {
      client.write(`event: face_result\n`);
      client.write(`data: ${payload}\n\n`);
    }
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event: 'face_result', data: event }));
      }
    }
  }
}

export const realtimeHub = new RealtimeHub();
