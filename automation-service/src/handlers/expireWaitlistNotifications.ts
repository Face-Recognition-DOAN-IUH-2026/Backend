import { borrowClient, notificationClient } from '../clients/serviceClients';

export async function expireWaitlistNotifications(
  cfg: Record<string, any>,
  _event?: any
): Promise<any> {
  const expiryHours = cfg.expiryHours || 24;

  try {
    const expired = await borrowClient.getExpiredWaitlist(expiryHours);

    if (!Array.isArray(expired) || expired.length === 0) {
      return { expired: 0, advanced: 0, message: 'No expired notifications' };
    }

    let advanced = 0;

    const results = await Promise.allSettled(
      expired.map(async (entry: any) => {
        const advanceData = await borrowClient.advanceWaitlist(entry.id);

        if (advanceData?.next) {
          await notificationClient.createNotification({
            userId: advanceData.next.patron_id,
            type: 'book_available',
            title: 'Sách đã có sẵn',
            body: `Cuốn sách bạn đang chờ đã có sẵn. Bạn có thể mượn ngay bây giờ!`,
            data: { bookId: advanceData.next.book_id },
          });

          await borrowClient.batchNotifyWaitlist([advanceData.next.id]).catch((err: any) => {
            console.warn('[expireWaitlistNotifications] Failed to batch notify waitlist:', (err as Error)?.message || err);
          });
          advanced++;
        }
      })
    );

    const failCount = results.filter(r => r.status === 'rejected').length;
    if (failCount > 0) {
      console.warn(`[expireWaitlistNotifications] ${failCount}/${expired.length} waitlist advancements failed`);
    }

    return { expired: expired.length, advanced };
  } catch {
    return { expired: 0, advanced: 0, message: 'Expiry check failed' };
  }
}
