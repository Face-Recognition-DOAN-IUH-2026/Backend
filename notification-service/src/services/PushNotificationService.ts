import axios from 'axios';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { deviceTokenService } from './DeviceTokenService';
import { AppDataSource } from '../data-source';
import { DeviceToken } from '../entities/DeviceToken';
import { config } from '../config';
import { getServiceToken } from '../../../shared/auth';

export class PushNotificationService {
  private expo = new Expo();

  async sendToUser(userId: string, notification: { title: string; body: string; data?: Record<string, any> }): Promise<void> {
    try {
      const tokens = await deviceTokenService.getTokensByUser(userId);
      const expoTokens = tokens.filter(t => Expo.isExpoPushToken(t.token));

      if (expoTokens.length === 0) return;

      const messages: ExpoPushMessage[] = expoTokens.map(t => ({
        to: t.token,
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        sound: 'default',
      }));

      const chunks = this.expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          const tickets: ExpoPushTicket[] = await this.expo.sendPushNotificationsAsync(chunk);
          for (const ticket of tickets) {
            if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
              const token = ticket.details?.expoPushToken;
              if (token) {
                await deviceTokenService.unregister(token);
              }
            }
          }
        } catch (err) {
          console.error('[PushNotificationService] chunk send error:', err);
        }
      }
    } catch (err) {
      console.error('[PushNotificationService] sendToUser error:', err);
    }
  }

  async sendBulk(userIds: string[], notification: { title: string; body: string; data?: Record<string, any> }): Promise<void> {
    try {
      // Chunk DB queries to avoid exhausting the connection pool
      const CHUNK_SIZE = 20;
      const flatTokens: { token: string }[] = [];
      for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
        const chunk = userIds.slice(i, i + CHUNK_SIZE);
        const chunkTokens = await Promise.all(chunk.map(id => deviceTokenService.getTokensByUser(id)));
        flatTokens.push(...chunkTokens.flat());
      }
      const expoTokens = flatTokens.filter(t => Expo.isExpoPushToken(t.token));

      if (expoTokens.length === 0) return;

      const messages: ExpoPushMessage[] = expoTokens.map(t => ({
        to: t.token,
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        sound: 'default',
      }));

      const chunks = this.expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          const tickets: ExpoPushTicket[] = await this.expo.sendPushNotificationsAsync(chunk);
          for (const ticket of tickets) {
            if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
              const token = ticket.details?.expoPushToken;
              if (token) {
                await deviceTokenService.unregister(token);
              }
            }
          }
        } catch (err) {
          console.error('[PushNotificationService] bulk chunk error:', err);
        }
      }
    } catch (err) {
      console.error('[PushNotificationService] sendBulk error:', err);
    }
  }

  async sendHazardBroadcast(hazardData: {
    camera_id?: string;
    location?: string;
    hazard_type?: string;
    confidence?: number;
    fire_count?: number;
    smoke_count?: number;
    confirmed_boxes?: any[];
    thumbnail_base64?: string | null;
    timestamp?: number;
  }): Promise<void> {
    try {
      const allTokens = await AppDataSource.getRepository(DeviceToken).find();
      if (allTokens.length === 0) return;

      const userIds = Array.from(new Set(allTokens.map((t) => t.userId)));

      // Query roles from user-service for role-targeted notifications
      const userRoles: Record<string, string> = {};
      try {
        const userServiceUrl = process.env.USER_SERVICE_URL || 'http://user-service:3001';
        const serviceToken = getServiceToken('notification-service', config.serviceJwtSecret);
        const res = await axios.post(
          `${userServiceUrl}/internal/users/batch`,
          { ids: userIds },
          { headers: { Authorization: `Bearer ${serviceToken}` }, timeout: 5000 }
        );
        for (const [uid, u] of Object.entries(res.data as Record<string, any>)) {
          userRoles[uid] = u.role || 'patron';
        }
      } catch (err: any) {
        console.warn('[PushNotificationService] Could not retrieve user roles for hazard broadcast:', err.message);
      }

      const locationStr = hazardData.location || 'Khu vực Thư viện';
      const hazardText = hazardData.hazard_type === 'smoke' ? 'khói bất thường' : 'nguy cơ cháy';
      const confPercent = Math.round((hazardData.confidence || 0.9) * 100);

      const messages: ExpoPushMessage[] = [];

      for (const t of allTokens) {
        if (!Expo.isExpoPushToken(t.token)) continue;
        const role = userRoles[t.userId] || 'patron';
        const isStaff = role === 'admin' || role === 'staff';

        if (isStaff) {
          messages.push({
            to: t.token,
            title: `🚨 [PCCC] PHÁT HIỆN ${hazardData.hazard_type === 'smoke' ? 'KHÓI' : 'LỬA'} - ${locationStr.toUpperCase()}`,
            body: `Camera ${hazardData.camera_id || 'PCCC'} phát hiện ${hazardText} tại ${locationStr} (Độ tin cậy: ${confPercent}%). Lực lượng PCCC lập tức kiểm tra hiện trường!`,
            data: {
              type: 'hazard_fire',
              roleTarget: 'staff',
              ...hazardData,
            },
            priority: 'high',
            sound: 'default',
            channelId: 'emergency',
          });
        } else {
          messages.push({
            to: t.token,
            title: `🚨 CẢNH BÁO KHẨN CẤP: NGUY CƠ CHÁY TẠI ${locationStr.toUpperCase()}`,
            body: `Hệ thống phát hiện ${hazardText} tại ${locationStr}. Độc giả vui lòng giữ bình tĩnh, di chuyển theo lối thoát hiểm gần nhất, TUYỆT ĐỐI KHÔNG dùng thang máy!`,
            data: {
              type: 'hazard_fire',
              roleTarget: 'patron',
              ...hazardData,
            },
            priority: 'high',
            sound: 'default',
            channelId: 'emergency',
          });
        }
      }

      const chunks = this.expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        try {
          await this.expo.sendPushNotificationsAsync(chunk);
        } catch (err) {
          console.error('[PushNotificationService] sendHazardBroadcast chunk error:', err);
        }
      }
      console.log(`[PushNotificationService] Sent hazard push notification to ${messages.length} device(s)`);
    } catch (err: any) {
      console.error('[PushNotificationService] sendHazardBroadcast error:', err.message);
    }
  }
}

export const pushNotificationService = new PushNotificationService();

