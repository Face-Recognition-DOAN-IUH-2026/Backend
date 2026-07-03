import { notificationClient } from '../clients/serviceClients';
import { config } from '../config';
import { AutomationEvent } from '../events/EventBus';
import { getServiceToken } from '../../../shared';

export async function bookAvailabilityNotify(
  _cfg: Record<string, any>,
  event?: AutomationEvent
): Promise<any> {
  if (!event || event.type !== 'book.returned') {
    return { notified: 0, message: 'Not a book.returned event' };
  }

  const { bookId, title: bookTitle } = event.payload;

  if (!bookId) {
    return { notified: 0, message: 'No bookId in event payload' };
  }

  try {
    const response = await fetch(
      `${config.services.borrowService}/borrow/internal/book/${bookId}/waitlist`,
      {
        headers: {
          'Authorization': `Bearer ${getServiceToken('automation-service', config.jwtSecret)}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return { notified: 0, message: 'No waitlist available for this book' };
    }

    const waitlist = await response.json();

    if (!Array.isArray(waitlist) || waitlist.length === 0) {
      return { notified: 0, message: 'No patrons waiting for this book' };
    }

    // Only notify the first patron in FIFO order
    const first = waitlist[0];
    await notificationClient.createNotification({
      userId: first.patron_id || first.patronId,
      type: 'book_available',
      title: 'Sách đã có sẵn',
      body: `Cuốn "${bookTitle || 'Sách'}" đã được trả. Bạn có thể mượn ngay bây giờ!`,
      data: { bookId, title: bookTitle },
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
          body: JSON.stringify({ ids: [first.id] }),
        }
      );
    } catch {}

    return { notified: 1, patronId: first.patron_id || first.patronId };
  } catch {
    return { notified: 0, message: 'Waitlist feature not available' };
  }
}
