import { borrowClient, notificationClient } from '../clients/serviceClients';
import { AutomationEvent } from '../events/EventBus';

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
    const waitlist = await borrowClient.getWaitlistByBook(bookId);

    if (!Array.isArray(waitlist) || waitlist.length === 0) {
      return { notified: 0, message: 'No patrons waiting for this book' };
    }

    const first = waitlist[0];
    await notificationClient.createNotification({
      userId: first.patron_id || first.patronId,
      type: 'book_available',
      title: 'Sách đã có sẵn',
      body: `Cuốn "${bookTitle || 'Sách'}" đã được trả. Bạn có thể mượn ngay bây giờ!`,
      data: { bookId, title: bookTitle },
    });

    try {
      await borrowClient.batchNotifyWaitlist([first.id]);
    } catch (err) {
      console.warn('[bookAvailabilityNotify] batch-notify failed:', (err as Error)?.message || err);
    }

    return { notified: 1, patronId: first.patron_id || first.patronId };
  } catch {
    return { notified: 0, message: 'Waitlist feature not available' };
  }
}
