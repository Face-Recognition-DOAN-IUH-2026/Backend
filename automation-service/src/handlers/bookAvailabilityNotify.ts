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

    const notifications = waitlist.map((entry: any) => ({
      userId: entry.patron_id || entry.patronId,
      type: 'book_available',
      title: 'Sách đã có sẵn',
      body: `Cuốn "${bookTitle || 'Sách'}" đã được trả. Bạn có thể mượn ngay bây giờ theo nguyên tắc đến trước phục vụ trước!`,
      data: { bookId, title: bookTitle },
    }));

    if (waitlist.length === 1) {
      await notificationClient.createNotification(notifications[0]);
    } else {
      await notificationClient.createBulkNotifications(notifications);
    }

    const ids = waitlist.map((entry: any) => entry.id);
    try {
      await borrowClient.batchNotifyWaitlist(ids);
    } catch (err) {
      console.warn('[bookAvailabilityNotify] batch-notify failed:', (err as Error)?.message || err);
    }

    return { notified: waitlist.length, patronCount: waitlist.length, bookId };
  } catch {
    return { notified: 0, message: 'Waitlist feature not available' };
  }
}
