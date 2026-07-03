jest.mock('../../clients/serviceClients');

import { expireWaitlistNotifications } from '../../handlers/expireWaitlistNotifications';
import { notificationClient } from '../../clients/serviceClients';

const mockNotificationClient = notificationClient as jest.Mocked<typeof notificationClient>;

function mockFetchOnce(data: any, ok = true) {
  return jest.fn().mockResolvedValueOnce({
    ok,
    json: jest.fn().mockResolvedValue(data),
  });
}

describe('expireWaitlistNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 0 when expired API fails', async () => {
    global.fetch = mockFetchOnce(null, false);

    const result = await expireWaitlistNotifications({ expiryHours: 24 });
    expect(result.expired).toBe(0);
    expect(result.advanced).toBe(0);
    expect(result.message).toBe('Failed to fetch expired entries');
  });

  it('returns 0 when no expired entries', async () => {
    global.fetch = mockFetchOnce([]);

    const result = await expireWaitlistNotifications({ expiryHours: 24 });
    expect(result.expired).toBe(0);
    expect(result.advanced).toBe(0);
    expect(result.message).toBe('No expired notifications');
  });

  it('expires entries and notifies next patron in queue', async () => {
    const expiredEntries = [
      { id: 'wl-1', book_id: 'b1', patron_id: 'p1', status: 'notified' },
    ];

    const advanceResponse = {
      expired: 'wl-1',
      next: { id: 'wl-2', patron_id: 'p2', book_id: 'b1' },
    };

    const batchNotifyResponse = { success: true };

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(expiredEntries) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(advanceResponse) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(batchNotifyResponse) });

    const result = await expireWaitlistNotifications({ expiryHours: 24 });

    expect(result.expired).toBe(1);
    expect(result.advanced).toBe(1);
    expect(mockNotificationClient.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'p2', type: 'book_available' })
    );
  });

  it('handles case where no next patron in queue', async () => {
    const expiredEntries = [
      { id: 'wl-1', book_id: 'b1', patron_id: 'p1', status: 'notified' },
    ];

    const advanceResponse = {
      expired: 'wl-1',
      next: null,
    };

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(expiredEntries) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(advanceResponse) });

    const result = await expireWaitlistNotifications({ expiryHours: 24 });

    expect(result.expired).toBe(1);
    expect(result.advanced).toBe(0);
    expect(mockNotificationClient.createNotification).not.toHaveBeenCalled();
  });

  it('does not crash when advance API fails', async () => {
    const expiredEntries = [
      { id: 'wl-1', book_id: 'b1', patron_id: 'p1', status: 'notified' },
    ];

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(expiredEntries) })
      .mockResolvedValueOnce({ ok: false });

    const result = await expireWaitlistNotifications({ expiryHours: 24 });

    expect(result.expired).toBe(1);
    expect(result.advanced).toBe(0);
  });

  it('handles multiple expired entries', async () => {
    const expiredEntries = [
      { id: 'wl-1', book_id: 'b1', patron_id: 'p1', status: 'notified' },
      { id: 'wl-3', book_id: 'b2', patron_id: 'p3', status: 'notified' },
    ];

    const advanceResponse1 = {
      expired: 'wl-1',
      next: { id: 'wl-2', patron_id: 'p2', book_id: 'b1' },
    };

    const advanceResponse2 = {
      expired: 'wl-3',
      next: null,
    };

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(expiredEntries) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(advanceResponse1) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(advanceResponse2) });

    const result = await expireWaitlistNotifications({ expiryHours: 24 });

    expect(result.expired).toBe(2);
    expect(result.advanced).toBe(1);
    expect(mockNotificationClient.createNotification).toHaveBeenCalledTimes(1);
  });
});
