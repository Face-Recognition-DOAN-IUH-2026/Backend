"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const checkDueSoonBorrows_1 = require("../../handlers/checkDueSoonBorrows");
const serviceClients_1 = require("../../clients/serviceClients");
const mockBorrowClient = serviceClients_1.borrowClient;
const mockNotificationClient = serviceClients_1.notificationClient;
const mockUserClient = serviceClients_1.userClient;
const mockEmailClient = serviceClients_1.emailClient;
describe('checkDueSoonBorrows', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return 0 checked when no due-soon borrows', async () => {
        mockBorrowClient.getDueSoonBorrows = jest.fn().mockResolvedValue([]);
        const result = await (0, checkDueSoonBorrows_1.checkDueSoonBorrows)({ days_before: 3 });
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
        mockUserClient.getUser = jest.fn()
            .mockResolvedValueOnce({ fullName: 'Patron A' })
            .mockResolvedValueOnce({ fullName: 'Patron B' });
        const result = await (0, checkDueSoonBorrows_1.checkDueSoonBorrows)({ days_before: 3 });
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
        mockUserClient.getUser = jest.fn().mockResolvedValue({ fullName: 'Nguyen Van A' });
        await (0, checkDueSoonBorrows_1.checkDueSoonBorrows)({ days_before: 3 });
        const call = mockNotificationClient.createBulkNotifications.mock.calls[0][0][0];
        expect(call.body).toContain('Nguyen Van A');
        expect(call.body).toContain('Great Book');
    });
    it('should fallback to "Bạn" when user not found', async () => {
        const mockRecords = [
            { id: 'r1', patron_id: 'p1', book_id: 'b1', due_at: new Date(Date.now() + 86400000).toISOString(), book: { title: 'Book' } },
        ];
        mockBorrowClient.getDueSoonBorrows = jest.fn().mockResolvedValue(mockRecords);
        mockUserClient.getUser = jest.fn().mockRejectedValue(new Error('Not found'));
        await (0, checkDueSoonBorrows_1.checkDueSoonBorrows)({ days_before: 3 });
        const call = mockNotificationClient.createBulkNotifications.mock.calls[0][0][0];
        expect(call.body).toContain('Bạn');
    });
    it('should default days_before to 3 when not provided', async () => {
        mockBorrowClient.getDueSoonBorrows = jest.fn().mockResolvedValue([]);
        await (0, checkDueSoonBorrows_1.checkDueSoonBorrows)({});
        expect(mockBorrowClient.getDueSoonBorrows).toHaveBeenCalledWith(3);
    });
    it('should handle null/undefined config gracefully', async () => {
        mockBorrowClient.getDueSoonBorrows = jest.fn().mockResolvedValue([]);
        await (0, checkDueSoonBorrows_1.checkDueSoonBorrows)(null);
        expect(mockBorrowClient.getDueSoonBorrows).toHaveBeenCalledWith(3);
    });
});
