import { notificationClient } from '../clients/serviceClients';
import { config } from '../config';
import { getServiceToken } from '../../../shared';

export async function expireWaitlistNotifications(
  cfg: Record<string, any>,
  _event?: any
): Promise<any> {
  const expiryHours = cfg.expiryHours || 24;

  try {
    const response = await fetch(
      `${config.services.borrowService}/borrow/internal/waitlist/expired?hours=${expiryHours}`,
      {
        headers: {
          'Authorization': `Bearer ${getServiceToken('automation-service', config.jwtSecret)}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return { expired: 0, advanced: 0, message: 'Failed to fetch expired entries' };
    }

    const expired: Array<{ id: string; book_id: string; patron_id: string; status: string }> = await response.json() as any;

    if (!Array.isArray(expired) || expired.length === 0) {
      return { expired: 0, advanced: 0, message: 'No expired notifications' };
    }

    let advanced = 0;

    for (const entry of expired) {
      try {
        const advanceRes = await fetch(
          `${config.services.borrowService}/borrow/internal/waitlist/advance/${entry.id}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${getServiceToken('automation-service', config.jwtSecret)}`,
              'Content-Type': 'application/json',
            },
          }
        );
        if (!advanceRes.ok) continue;

        const advanceData: any = await advanceRes.json();
        if (advanceData.next) {
          await notificationClient.createNotification({
            userId: advanceData.next.patron_id,
            type: 'book_available',
            title: 'Sách đã có sẵn',
            body: `Cuốn sách bạn đang chờ đã có sẵn. Bạn có thể mượn ngay bây giờ!`,
            data: { bookId: advanceData.next.book_id },
          });

          try {
            await fetch(
              `${config.services.borrowService}/borrow/internal/waitlist/batch-notify`,
              {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${getServiceToken('automation-service', config.jwtSecret)}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: [advanceData.next.id] }),
              }
            );
          } catch {}
          advanced++;
        }
      } catch {}
    }

    return { expired: expired.length, advanced };
  } catch {
    return { expired: 0, advanced: 0, message: 'Expiry check failed' };
  }
}
