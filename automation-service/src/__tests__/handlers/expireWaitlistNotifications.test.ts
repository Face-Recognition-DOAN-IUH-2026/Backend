jest.mock('../../clients/serviceClients');

import { expireWaitlistNotifications } from '../../handlers/expireWaitlistNotifications';
import { borrowClient, notificationClient } from '../../clients/serviceClients';

const mockBorrowClient = borrowClient as jest.Mocked<typeof borrowClient>;
const mockNotificationClient = notificationClient as jest.Mocked<typeof notificationClient>;

describe('expireWaitlistNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 0 when expired API fails', async () => {
    mockBorrowClient.getExpiredWaitlist = jest.fn().mockRejectedValue(new Error('API error'));

    const result = await expireWaitlistNotifications({ expiryHours: 24 });
    expect(result.expired).toBe(0);
    expect(result.advanced).toBe(0);
    expect(result.message).toBe('Expiry check failed');
  });

  it('returns 0 when no expired entries', async () => {
    mockBorrowClient.getExpiredWaitlist = jest.fn().mockResolvedValue([]);

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

    mockBorrowClient.getExpiredWaitlist = jest.fn().mockResolvedValue(expiredEntries);
    mockBorrowClient.advanceWaitlist = jest.fn().mockResolvedValue(advanceResponse);
    mockBorrowClient.batchNotifyWaitlist = jest.fn().mockResolvedValue({});

    const result = await expireWaitlistNotifications({ expiryHours: 24 });

    expect(result.expired).toBe(1);
    expect(result.advanced).toBe(1);
    expect(mockBorrowClient.advanceWaitlist).toHaveBeenCalledWith('wl-1');
    expect(mockBorrowClient.batchNotifyWaitlist).toHaveBeenCalledWith(['wl-2']);
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

    mockBorrowClient.getExpiredWaitlist = jest.fn().mockResolvedValue(expiredEntries);
    mockBorrowClient.advanceWaitlist = jest.fn().mockResolvedValue(advanceResponse);

    const result = await expireWaitlistNotifications({ expiryHours: 24 });

    expect(result.expired).toBe(1);
    expect(result.advanced).toBe(0);
    expect(mockNotificationClient.createNotification).not.toHaveBeenCalled();
  });

  it('does not crash when advance API fails', async () => {
    const expiredEntries = [
      { id: 'wl-1', book_id: 'b1', patron_id: 'p1', status: 'notified' },
    ];

    mockBorrowClient.getExpiredWaitlist = jest.fn().mockResolvedValue(expiredEntries);
    mockBorrowClient.advanceWaitlist = jest.fn().mockRejectedValue(new Error('API error'));

    const result = await expireWaitlistNotifications({ expiryHours: 24 });

    expect(result.expired).toBe(1);
    expect(result.advanced).toBe(0);
    expect(mockBorrowClient.advanceWaitlist).toHaveBeenCalledWith('wl-1');
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

    mockBorrowClient.getExpiredWaitlist = jest.fn().mockResolvedValue(expiredEntries);
    mockBorrowClient.advanceWaitlist = jest.fn()
      .mockResolvedValueOnce(advanceResponse1)
      .mockResolvedValueOnce(advanceResponse2);
    mockBorrowClient.batchNotifyWaitlist = jest.fn().mockResolvedValue({});

    const result = await expireWaitlistNotifications({ expiryHours: 24 });

    expect(result.expired).toBe(2);
    expect(result.advanced).toBe(1);
    expect(mockBorrowClient.advanceWaitlist).toHaveBeenCalledTimes(2);
    expect(mockNotificationClient.createNotification).toHaveBeenCalledTimes(1);
  });
});
