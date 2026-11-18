const mockConnect = jest.fn();
const mockConsume = jest.fn();
const mockSubscribeTopic = jest.fn();

jest.mock('../../clients/AmqpClient', () => ({
  amqpClient: {
    connect: mockConnect,
    consume: mockConsume,
    subscribeTopic: mockSubscribeTopic,
  },
}));

const mockNotifCreate = jest.fn(async (input: any) => ({ id: 'notif-1', ...input }));
jest.mock('../../services/NotificationService', () => ({
  notificationService: {
    create: mockNotifCreate,
  },
}));

const mockPublish = jest.fn();
const mockBroadcastHazard = jest.fn();
jest.mock('../../realtime/NotificationHub', () => ({
  notificationHub: {
    publish: mockPublish,
    broadcastHazard: mockBroadcastHazard,
  },
}));

const mockVerifyConnection = jest.fn().mockResolvedValue(undefined);
const mockSendOverdueEmail = jest.fn().mockResolvedValue(undefined);
const mockSendFineEmail = jest.fn().mockResolvedValue(undefined);
const mockUpdateConfig = jest.fn();

jest.mock('../../services/EmailService', () => ({
  EmailService: jest.fn().mockImplementation(() => ({
    verifyConnection: mockVerifyConnection,
    sendOverdueEmail: mockSendOverdueEmail,
    sendFineEmail: mockSendFineEmail,
    updateConfig: mockUpdateConfig,
  })),
}));

import { startAmqpSubscriber } from '../../subscribers/AmqpSubscriber';

describe('AmqpSubscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles book.borrowed, book.returned, push, email and re-throws SMTP errors for DLQ retry', async () => {
    await startAmqpSubscriber();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConsume).toHaveBeenCalledWith(
      'notification_service_queue',
      ['book.borrowed', 'book.returned', 'notification.send', 'config.updated'],
      expect.any(Function),
    );
    expect(mockSubscribeTopic).toHaveBeenCalledWith(
      'hazard_exchange',
      'hazard.#',
      'notification_hazard_queue',
      expect.any(Function),
    );

    const handler = mockConsume.mock.calls[0][2];

    // 1. book.borrowed
    await handler({
      eventType: 'book.borrowed',
      payload: { patronId: 'p-1', title: 'Clean Code', dueAt: '2026-12-01T00:00:00Z' },
    });
    expect(mockNotifCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'p-1',
      type: 'borrow',
    }));
    expect(mockPublish).toHaveBeenCalledWith('p-1', expect.objectContaining({ type: 'borrow' }));

    // 2. notification.send -> push
    await handler({
      eventType: 'notification.send',
      payload: { emailType: 'push', userId: 'p-2', type: 'fine', title: 'Phạt trễ hạn', body: '50,000đ' },
    });
    expect(mockPublish).toHaveBeenCalledWith('p-2', expect.objectContaining({ type: 'fine' }));

    // 3. config.updated -> smtp hot reload
    await handler({
      eventType: 'config.updated',
      payload: { category: 'smtp', values: { host: 'smtp.iuh.edu.vn' } },
    });
    expect(mockUpdateConfig).toHaveBeenCalledWith({ host: 'smtp.iuh.edu.vn' });

    // 4. SMTP failure re-throws so AmqpClient retries / routes to DLQ
    mockSendFineEmail.mockRejectedValueOnce(new Error('SMTP timeout'));
    await expect(
      handler({
        eventType: 'notification.send',
        payload: { emailType: 'fine', toEmail: 'sv@iuh.edu.vn', bookTitle: 'Clean Code', fineAmount: 50000, daysOverdue: 10 },
      }),
    ).rejects.toThrow('SMTP timeout');
  });
});
