import { checkOverdueBorrows } from '../../handlers/checkOverdueBorrows';
import { borrowClient, notificationClient, userClient, emailClient } from '../../clients/serviceClients';

const mockBorrowClient = borrowClient as jest.Mocked<typeof borrowClient>;
const mockNotificationClient = notificationClient as jest.Mocked<typeof notificationClient>;
const mockUserClient = userClient as jest.Mocked<typeof userClient>;
const mockEmailClient = emailClient as jest.Mocked<typeof emailClient>;

describe('checkOverdueBorrows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 0 when no overdue borrows', async () => {
    mockBorrowClient.getOverdueBorrows = jest.fn().mockResolvedValue([]);

    const result = await checkOverdueBorrows({ notify_patrons: true });

    expect(result.checked).toBe(0);
    expect(result.notified).toBe(0);
  });

  it('should create notifications for overdue records on periodic reminder days (day 1, 3, 6...)', async () => {
    const pastDate = new Date(Date.now() - 3 * 86400000).toISOString();
    const mockRecords = [
      { id: 'r1', patron_id: 'p1', book_id: 'b1', due_at: pastDate, book: { title: 'Overdue Book' } },
    ];
    mockBorrowClient.getOverdueBorrows = jest.fn().mockResolvedValue(mockRecords);
    mockUserClient.getUsers = jest.fn().mockResolvedValue({ p1: { fullName: 'Test Patron' } });

    const result = await checkOverdueBorrows({ notify_patrons: true });

    expect(result.checked).toBe(1);
    expect(result.notified).toBe(1);
    expect(mockNotificationClient.createBulkNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'p1',
        type: 'overdue_reminder',
        title: 'Nhắc trả sách quá hạn',
        body: expect.stringContaining('10.000 đ'),
      }),
    ]);
  });

  it('should skip non-periodic reminder days (e.g. day 2, 5)', async () => {
    const pastDate = new Date(Date.now() - 5 * 86400000).toISOString();
    const mockRecords = [
      { id: 'r1', patron_id: 'p1', book_id: 'b1', due_at: pastDate, book: { title: 'Overdue Book' } },
    ];
    mockBorrowClient.getOverdueBorrows = jest.fn().mockResolvedValue(mockRecords);
    mockUserClient.getUsers = jest.fn().mockResolvedValue({ p1: { fullName: 'Test Patron' } });

    const result = await checkOverdueBorrows({ notify_patrons: true });

    expect(result.checked).toBe(1);
    expect(result.notified).toBe(0);
    expect(mockNotificationClient.createBulkNotifications).not.toHaveBeenCalled();
  });

  it('should send overdue email when patron email is available', async () => {
    const pastDate = new Date(Date.now() - 3 * 86400000).toISOString();
    const mockRecords = [
      { id: 'r1', patron_id: 'p1', book_id: 'b1', due_at: pastDate, book: { title: 'Late Book' } },
    ];
    mockBorrowClient.getOverdueBorrows = jest.fn().mockResolvedValue(mockRecords);
    mockUserClient.getUsers = jest.fn().mockResolvedValue({ p1: { fullName: 'Test', email: 'patron@test.com' } });

    await checkOverdueBorrows({ notify_patrons: true });

    expect(mockEmailClient.sendOverdueEmail).toHaveBeenCalledWith('patron@test.com', 'Late Book', 3, 10000);
  });

  it('should not send email when patron has no email', async () => {
    const pastDate = new Date(Date.now() - 3 * 86400000).toISOString();
    const mockRecords = [
      { id: 'r1', patron_id: 'p1', book_id: 'b1', due_at: pastDate, book: { title: 'Book' } },
    ];
    mockBorrowClient.getOverdueBorrows = jest.fn().mockResolvedValue(mockRecords);
    mockUserClient.getUsers = jest.fn().mockResolvedValue({ p1: { fullName: 'Test' } });

    await checkOverdueBorrows({ notify_patrons: true });

    expect(mockEmailClient.sendOverdueEmail).not.toHaveBeenCalled();
  });

  it('should not crash when email send fails', async () => {
    const pastDate = new Date(Date.now() - 3 * 86400000).toISOString();
    const mockRecords = [
      { id: 'r1', patron_id: 'p1', book_id: 'b1', due_at: pastDate, book: { title: 'Book' } },
    ];
    mockBorrowClient.getOverdueBorrows = jest.fn().mockResolvedValue(mockRecords);
    mockUserClient.getUsers = jest.fn().mockResolvedValue({ p1: { fullName: 'Test', email: 'patron@test.com' } });
    mockEmailClient.sendOverdueEmail = jest.fn().mockRejectedValue(new Error('SMTP down'));

    const result = await checkOverdueBorrows({ notify_patrons: true });

    expect(result.notified).toBe(1);
  });

  it('should not crash when userClient fails', async () => {
    const pastDate = new Date(Date.now() - 3 * 86400000).toISOString();
    const mockRecords = [
      { id: 'r1', patron_id: 'p1', book_id: 'b1', due_at: pastDate, book: { title: 'Book' } },
    ];
    mockBorrowClient.getOverdueBorrows = jest.fn().mockResolvedValue(mockRecords);
    mockUserClient.getUsers = jest.fn().mockRejectedValue(new Error('User service down'));

    const result = await checkOverdueBorrows({ notify_patrons: true });

    expect(result.notified).toBe(1);
    const call = mockNotificationClient.createBulkNotifications.mock.calls[0][0][0];
    expect(call.body).toContain('Bạn');
  });

  it('should use patronId from patronId field (camelCase)', async () => {
    const pastDate = new Date(Date.now() - 1 * 86400000).toISOString();
    const mockRecords = [
      { id: 'r1', patronId: 'p-camel', bookId: 'b1', dueAt: pastDate, book: { title: 'Book' } },
    ];
    mockBorrowClient.getOverdueBorrows = jest.fn().mockResolvedValue(mockRecords);
    mockUserClient.getUsers = jest.fn().mockResolvedValue({ 'p-camel': { fullName: 'Test' } });

    await checkOverdueBorrows({ notify_patrons: true });

    const call = mockNotificationClient.createBulkNotifications.mock.calls[0][0][0];
    expect(call.userId).toBe('p-camel');
  });
});
