"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fineNotification_1 = require("../../handlers/fineNotification");
const serviceClients_1 = require("../../clients/serviceClients");
const mockNotificationClient = serviceClients_1.notificationClient;
const mockUserClient = serviceClients_1.userClient;
const mockEmailClient = serviceClients_1.emailClient;
describe('fineNotification', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should skip when event type is not fine.incurred', async () => {
        const result = await (0, fineNotification_1.fineNotification)({}, { type: 'other.event', payload: {}, timestamp: '' });
        expect(result.skipped).toBe(true);
        expect(mockNotificationClient.createNotification).not.toHaveBeenCalled();
    });
    it('should skip when no event provided', async () => {
        const result = await (0, fineNotification_1.fineNotification)({});
        expect(result.skipped).toBe(true);
    });
    it('should skip when patronId is missing', async () => {
        const result = await (0, fineNotification_1.fineNotification)({}, { type: 'fine.incurred', payload: { fineAmount: 5000 }, timestamp: '' });
        expect(result.skipped).toBe(true);
    });
    it('should skip when fineAmount is missing', async () => {
        const result = await (0, fineNotification_1.fineNotification)({}, { type: 'fine.incurred', payload: { patronId: 'p1' }, timestamp: '' });
        expect(result.skipped).toBe(true);
    });
    it('should create notification with correct data', async () => {
        mockUserClient.getUser = jest.fn().mockResolvedValue({ fullName: 'Tran Van B' });
        await (0, fineNotification_1.fineNotification)({}, {
            type: 'fine.incurred',
            payload: { patronId: 'p1', bookTitle: 'Test Book', fineAmount: 10000, daysOverdue: 5, borrowRecordId: 'r1' },
            timestamp: '',
        });
        expect(mockNotificationClient.createNotification).toHaveBeenCalledWith({
            userId: 'p1',
            type: 'fine_notice',
            title: 'Phí phạt trễ hạn',
            body: expect.stringContaining('Tran Van B'),
            data: expect.objectContaining({ fineAmount: 10000, daysOverdue: 5 }),
        });
    });
    it('should include fine amount in notification body', async () => {
        mockUserClient.getUser = jest.fn().mockResolvedValue({ fullName: 'Test' });
        await (0, fineNotification_1.fineNotification)({}, {
            type: 'fine.incurred',
            payload: { patronId: 'p1', bookTitle: 'Book', fineAmount: 25000, daysOverdue: 3, borrowRecordId: 'r1' },
            timestamp: '',
        });
        const call = mockNotificationClient.createNotification.mock.calls[0][0];
        expect(call.body).toContain('25.000');
    });
    it('should send fine email when patron email is available', async () => {
        mockUserClient.getUser = jest.fn().mockResolvedValue({ fullName: 'Test', email: 'test@example.com' });
        await (0, fineNotification_1.fineNotification)({}, {
            type: 'fine.incurred',
            payload: { patronId: 'p1', bookTitle: 'Book', fineAmount: 5000, daysOverdue: 2, borrowRecordId: 'r1' },
            timestamp: '',
        });
        expect(mockEmailClient.sendFineEmail).toHaveBeenCalledWith('test@example.com', 'Book', 5000, 2);
    });
    it('should not send email when patron has no email', async () => {
        mockUserClient.getUser = jest.fn().mockResolvedValue({ fullName: 'Test' });
        await (0, fineNotification_1.fineNotification)({}, {
            type: 'fine.incurred',
            payload: { patronId: 'p1', bookTitle: 'Book', fineAmount: 5000, daysOverdue: 2, borrowRecordId: 'r1' },
            timestamp: '',
        });
        expect(mockEmailClient.sendFineEmail).not.toHaveBeenCalled();
    });
    it('should not crash when email send fails', async () => {
        mockUserClient.getUser = jest.fn().mockResolvedValue({ fullName: 'Test', email: 'test@example.com' });
        mockEmailClient.sendFineEmail = jest.fn().mockRejectedValue(new Error('SMTP error'));
        const result = await (0, fineNotification_1.fineNotification)({}, {
            type: 'fine.incurred',
            payload: { patronId: 'p1', bookTitle: 'Book', fineAmount: 5000, daysOverdue: 2, borrowRecordId: 'r1' },
            timestamp: '',
        });
        expect(result.notified).toBe(1);
    });
    it('should fallback to "Bạn" when user not found', async () => {
        mockUserClient.getUser = jest.fn().mockRejectedValue(new Error('Not found'));
        await (0, fineNotification_1.fineNotification)({}, {
            type: 'fine.incurred',
            payload: { patronId: 'p1', bookTitle: 'Book', fineAmount: 5000, daysOverdue: 2, borrowRecordId: 'r1' },
            timestamp: '',
        });
        const call = mockNotificationClient.createNotification.mock.calls[0][0];
        expect(call.body).toContain('Bạn');
    });
});
