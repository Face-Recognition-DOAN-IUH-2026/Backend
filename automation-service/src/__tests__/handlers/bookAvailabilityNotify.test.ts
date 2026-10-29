jest.mock('../../clients/serviceClients');

import { bookAvailabilityNotify } from '../../handlers/bookAvailabilityNotify';
import { borrowClient, notificationClient } from '../../clients/serviceClients';

const mockBorrowClient = borrowClient as jest.Mocked<typeof borrowClient>;
const mockNotificationClient = notificationClient as jest.Mocked<typeof notificationClient>;

describe('bookAvailabilityNotify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 0 when event is not book.returned', async () => {
    const result = await bookAvailabilityNotify({}, { type: 'book.borrowed', payload: {} } as any);
    expect(result.notified).toBe(0);
    expect(result.message).toBe('Not a book.returned event');
  });

  it('returns 0 when no bookId in payload', async () => {
    const result = await bookAvailabilityNotify({}, { type: 'book.returned', payload: {} } as any);
    expect(result.notified).toBe(0);
    expect(result.message).toBe('No bookId in event payload');
  });

  it('throws when waitlist API returns error', async () => {
    mockBorrowClient.getWaitlistByBook = jest.fn().mockRejectedValue(new Error('API error'));

    await expect(
      bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1', title: 'Test Book' } } as any)
    ).rejects.toThrow('API error');
  });

  it('returns 0 when waitlist is empty', async () => {
    mockBorrowClient.getWaitlistByBook = jest.fn().mockResolvedValue([]);

    const result = await bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1', title: 'Test Book' } } as any);
    expect(result.notified).toBe(0);
    expect(result.message).toBe('No patrons waiting for this book');
  });

  it('broadcasts notifications to all subscribed patrons', async () => {
    const waitlist = [
      { id: 'wl-1', patron_id: 'p1', book_id: 'b1', status: 'waiting', created_at: '2025-01-01' },
      { id: 'wl-2', patron_id: 'p2', book_id: 'b1', status: 'waiting', created_at: '2025-01-02' },
      { id: 'wl-3', patron_id: 'p3', book_id: 'b1', status: 'waiting', created_at: '2025-01-03' },
    ];

    mockBorrowClient.getWaitlistByBook = jest.fn().mockResolvedValue(waitlist);
    mockBorrowClient.batchNotifyWaitlist = jest.fn().mockResolvedValue({});
    mockNotificationClient.createBulkNotifications = jest.fn().mockResolvedValue({ success: true });

    const result = await bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1', title: 'Test Book' } } as any);

    expect(result.notified).toBe(3);
    expect(result.patronCount).toBe(3);
    expect(mockNotificationClient.createBulkNotifications).toHaveBeenCalledTimes(1);
    expect(mockNotificationClient.createBulkNotifications).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'p1', type: 'book_available' }),
        expect.objectContaining({ userId: 'p2', type: 'book_available' }),
        expect.objectContaining({ userId: 'p3', type: 'book_available' }),
      ])
    );
    expect(mockBorrowClient.batchNotifyWaitlist).toHaveBeenCalledWith(['wl-1', 'wl-2', 'wl-3']);
  });

  it('handles patron_id field in camelCase', async () => {
    const waitlist = [
      { id: 'wl-1', patronId: 'p-camel', bookId: 'b1', status: 'waiting', createdAt: '2025-01-01' },
    ];

    mockBorrowClient.getWaitlistByBook = jest.fn().mockResolvedValue(waitlist);
    mockBorrowClient.batchNotifyWaitlist = jest.fn().mockResolvedValue({});

    const result = await bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1', title: 'Book' } } as any);

    expect(result.notified).toBe(1);
    expect(mockNotificationClient.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'p-camel' })
    );
  });

  it('does not crash when batch-notify API fails', async () => {
    const waitlist = [
      { id: 'wl-1', patron_id: 'p1', book_id: 'b1', status: 'waiting' },
    ];

    mockBorrowClient.getWaitlistByBook = jest.fn().mockResolvedValue(waitlist);
    mockBorrowClient.batchNotifyWaitlist = jest.fn().mockRejectedValue(new Error('Network error'));

    const result = await bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1', title: 'Book' } } as any);

    expect(result.notified).toBe(1);
  });
});
