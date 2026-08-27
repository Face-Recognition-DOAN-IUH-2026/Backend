import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { deviceTokenService } from './DeviceTokenService';

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
      const allTokens = await Promise.all(userIds.map(id => deviceTokenService.getTokensByUser(id)));
      const flatTokens = allTokens.flat().filter(t => Expo.isExpoPushToken(t.token));

      if (flatTokens.length === 0) return;

      const messages: ExpoPushMessage[] = flatTokens.map(t => ({
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
}

export const pushNotificationService = new PushNotificationService();
