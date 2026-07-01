import { checkDueSoonBorrows } from '../../handlers/checkDueSoonBorrows';
import { borrowClient, notificationClient, userClient, emailClient } from '../../clients/serviceClients';

const mockBorrowClient = borrowClient as jest.Mocked<typeof borrowClient>;
const mockNotificationClient = notificationClient as jest.Mocked<typeof notificationClient>;
const mockUserClient = userClient as jest.Mocked<typeof userClient>;
const mockEmailClient = emailClient as jest.Mocked<typeof emailClient>;

describe('checkDueSoonBorrows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 0 checked when no due-soon borrows', async () => {
    mockBorrowClient.getDueSoonBorrows = jest.fn().mockResolvedValue([]);

    const result = await checkDueSoonBorrows({ days_before: 3 });

    expect(result.checked).toBe(0);
    expect(result.notified).toBe(0);
    expect(mockNotificationClient.createBulkNotifications).not.toHaveBeenCalled();
  });

  it('should create notifications for each due-soon record', async () => {
    const mockRecords = [
      { id: 'r1', patron_id: 'p1', book_id: 'b1', due_at: new Date(Date.now() + 2 * 86400000).toISOString(), book: { title: 'Book A' } },
      { id: 'r2', patron_id: 'p2', book_id: 'b2', due_at: new Date(Date.now() + 1 * 86400000).toISOString(), book: { title: 'Book B' } },
    ];
    mockBorrowClient.getDueSoonBorrows = jest.fn().mockResolvedValue(mockRecords);
    mockUserClient.getUsers = jest.fn().mockResolvedValue({
      p1: { fullName: 'Patron A' },
      p2: { fullName: 'Patron B' },
    });

    const result = await checkDueSoonBorrows({ days_before: 3 });

    expect(result.checked).toBe(2);
    expect(result.notified).toBe(2);
    expect(mockNotificationClient.createBulkNotifications).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'p1', type: 'due_soon_reminder', title: 'Sách sắp đến hạn trả' }),
      expect.objectContaining({ userId: 'p2', type: 'due_soon_reminder', title: 'Sách sắp đến hạn trả' }),
    ]);
  });

  it('should use patron name in notification body', async () => {
    const mockRecords = [
      { id: 'r1', patron_id: 'p1', book_id: 'b1', due_at: new Date(Date.now() + 86400000).toISOString(), book: { title: 'Great Book' } },
    ];
    mockBorrowClient.getDueSoonBorrows = jest.fn().mockResolvedValue(mockRecords);
    mockUserClient.getUsers = jest.fn().mockResolvedValue({ p1: { fullName: 'Nguyen Van A' } });

    await checkDueSoonBorrows({ days_before: 3 });

    const call = mockNotificationClient.createBulkNotifications.mock.calls[0][0][0];
    expect(call.body).toContain('Nguyen Van A');
    expect(call.body).toContain('Great Book');
  });

  it('should fallback to "Bạn" when user not found', async () => {
    const mockRecords = [
      { id: 'r1', patron_id: 'p1', book_id: 'b1', due_at: new Date(Date.now() + 86400000).toISOString(), book: { title: 'Book' } },
    ];
    mockBorrowClient.getDueSoonBorrows = jest.fn().mockResolvedValue(mockRecords);
    mockUserClient.getUsers = jest.fn().mockRejectedValue(new Error('Not found'));

    await checkDueSoonBorrows({ days_before: 3 });

    const call = mockNotificationClient.createBulkNotifications.mock.calls[0][0][0];
    expect(call.body).toContain('Bạn');
  });

  it('should default days_before to 3 when not provided', async () => {
    mockBorrowClient.getDueSoonBorrows = jest.fn().mockResolvedValue([]);

    await checkDueSoonBorrows({});

    expect(mockBorrowClient.getDueSoonBorrows).toHaveBeenCalledWith(3);
  });

  it('should handle null/undefined config gracefully', async () => {
    mockBorrowClient.getDueSoonBorrows = jest.fn().mockResolvedValue([]);

    await checkDueSoonBorrows(null as any);

    expect(mockBorrowClient.getDueSoonBorrows).toHaveBeenCalledWith(3);
  });
});
