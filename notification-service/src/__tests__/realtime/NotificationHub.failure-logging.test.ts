import { Response } from 'express';
import { WebSocket } from 'ws';

jest.mock('../../clients/AmqpClient', () => ({
  amqpClient: {
    connect: jest.fn(),
    subscribeFanout: jest.fn(),
    publishFanout: jest.fn(),
  },
}));
jest.mock('../../services/PushNotificationService', () => ({
  pushNotificationService: {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendHazardBroadcast: jest.fn().mockResolvedValue(undefined),
    sendBulk: jest.fn().mockResolvedValue(undefined),
  },
}));

// jest.setup.js globally mocks this module — use requireActual to get the real class
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NotificationHub } = jest.requireActual('../../realtime/NotificationHub');

function createSseClient(): Response {
  let pushCall = 0;
  return {
    write: jest.fn().mockImplementation((data: string) => {
      // keepalive lines start with ':', only fail on actual notification/hazard writes
      if (typeof data === 'string' && !data.startsWith(':')) {
        pushCall += 1;
        if (pushCall > 1) throw new Error('SSE broken');
      }
    }),
    on: jest.fn(),
  } as unknown as Response;
}

function createWsClient(): WebSocket {
  let pushCall = 0;
  return {
    readyState: WebSocket.OPEN,
    send: jest.fn().mockImplementation(() => {
      pushCall += 1;
      if (pushCall > 1) throw new Error('WS broken');
    }),
    on: jest.fn(),
  } as unknown as WebSocket;
}

describe('NotificationHub failure logging (#23)', () => {
  let hub: any;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    hub = new NotificationHub();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // reset call counts but keep mock implementations
    jest.clearAllMocks();
    // re-establish default resolved value cleared by clearAllMocks
    const { pushNotificationService } = require('../../services/PushNotificationService');
    (pushNotificationService.sendToUser as jest.Mock).mockResolvedValue(undefined);
    (pushNotificationService.sendHazardBroadcast as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('logs when SSE client write fails during pushToUser', async () => {
    const sse = createSseClient();
    hub.addSseClient('u1', sse);

    const notification = { id: 'n1', title: 'T', body: 'B', data: {} } as any;
    await hub.pushToUser('u1', notification);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NotificationHub]'),
      expect.any(Error)
    );
  });

  it('logs when WS client send fails during pushToUser', async () => {
    const ws = createWsClient();
    hub.addWsClient('u1', ws);

    const notification = { id: 'n1', title: 'T', body: 'B', data: {} } as any;
    await hub.pushToUser('u1', notification);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NotificationHub]'),
      expect.any(Error)
    );
  });

  it('logs when push notification sendToUser rejects', async () => {
    const { pushNotificationService } = require('../../services/PushNotificationService');
    (pushNotificationService.sendToUser as jest.Mock).mockRejectedValue(new Error('Expo down'));

    const notification = { id: 'n1', title: 'T', body: 'B', data: {} } as any;
    await hub.pushToUser('u1', notification);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NotificationHub]'),
      expect.any(Error)
    );
  });

  it('logs when broadcastHazard WS send fails', async () => {
    const ws = createWsClient();
    hub.addWsClient('u1', ws);

    await hub.broadcastHazard({ camera_id: 'c1' });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NotificationHub]'),
      expect.any(Error)
    );
  });

  it('logs when broadcastHazard SSE write fails', async () => {
    const sse = createSseClient();
    hub.addSseClient('u1', sse);

    await hub.broadcastHazard({ camera_id: 'c1' });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NotificationHub]'),
      expect.any(Error)
    );
  });
});
