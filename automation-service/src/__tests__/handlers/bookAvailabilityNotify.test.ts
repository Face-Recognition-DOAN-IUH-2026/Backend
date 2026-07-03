jest.mock('../../clients/serviceClients');

import { bookAvailabilityNotify } from '../../handlers/bookAvailabilityNotify';
import { notificationClient } from '../../clients/serviceClients';

const mockNotificationClient = notificationClient as jest.Mocked<typeof notificationClient>;

function mockFetchOnce(data: any, ok = true) {
  return jest.fn().mockResolvedValueOnce({
    ok,
    json: jest.fn().mockResolvedValue(data),
  });
}

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

  it('returns 0 when waitlist API returns error', async () => {
    global.fetch = mockFetchOnce(null, false);

    const result = await bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1', title: 'Test Book' } } as any);
    expect(result.notified).toBe(0);
    expect(result.message).toBe('No waitlist available for this book');
  });

  it('returns 0 when waitlist is empty', async () => {
    global.fetch = mockFetchOnce([]);

    const result = await bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1', title: 'Test Book' } } as any);
    expect(result.notified).toBe(0);
    expect(result.message).toBe('No patrons waiting for this book');
  });

  it('notifies only the first patron in FIFO order', async () => {
    const waitlist = [
      { id: 'wl-1', patron_id: 'p1', book_id: 'b1', status: 'waiting', created_at: '2025-01-01' },
      { id: 'wl-2', patron_id: 'p2', book_id: 'b1', status: 'waiting', created_at: '2025-01-02' },
      { id: 'wl-3', patron_id: 'p3', book_id: 'b1', status: 'waiting', created_at: '2025-01-03' },
    ];

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(waitlist) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({}) });

    const result = await bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1', title: 'Test Book' } } as any);

    expect(result.notified).toBe(1);
    expect(result.patronId).toBe('p1');
    expect(mockNotificationClient.createNotification).toHaveBeenCalledTimes(1);
    expect(mockNotificationClient.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'p1', type: 'book_available' })
    );
    expect(mockNotificationClient.createBulkNotifications).not.toHaveBeenCalled();
  });

  it('handles patron_id field in camelCase', async () => {
    const waitlist = [
      { id: 'wl-1', patronId: 'p-camel', bookId: 'b1', status: 'waiting', createdAt: '2025-01-01' },
    ];

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(waitlist) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({}) });

    const result = await bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1', title: 'Book' } } as any);

    expect(result.notified).toBe(1);
    expect(result.patronId).toBe('p-camel');
    expect(mockNotificationClient.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'p-camel' })
    );
  });

  it('does not crash when batch-notify API fails', async () => {
    const waitlist = [
      { id: 'wl-1', patron_id: 'p1', book_id: 'b1', status: 'waiting' },
    ];

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(waitlist) })
      .mockRejectedValueOnce(new Error('Network error'));

    const result = await bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1', title: 'Book' } } as any);

    expect(result.notified).toBe(1);
  });
});
