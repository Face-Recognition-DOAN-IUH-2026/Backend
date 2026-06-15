import { randomUUID } from 'crypto';
import { Response } from 'express';
import Redis from 'ioredis';
import { WebSocket } from 'ws';
import { config } from '../config';
import { AccessRealtimeEvent } from '../contracts';

const CHANNEL = 'access.events';

export class RealtimeHub {
  private sseClients = new Set<Response>();
  private wsClients = new Set<WebSocket>();
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
        this.broadcastLocal(message.event as AccessRealtimeEvent);
      } catch {
        // Ignore malformed messages from the shared channel.
      }
    });
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
    if (this.publisher) {
      await this.publisher.publish(CHANNEL, JSON.stringify({ originId: this.instanceId, event }));
    }
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
}

export const realtimeHub = new RealtimeHub();
