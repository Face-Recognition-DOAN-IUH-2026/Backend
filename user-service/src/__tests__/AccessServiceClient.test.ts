import { accessServiceClient, accessCircuit } from '../clients/AccessServiceClient';

jest.unmock('../config');
jest.mock('../../../shared/auth', () => ({
  getServiceToken: () => 'mock-service-token',
}));

function mockFetchResponse(status: number, body?: any) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => (body ? JSON.stringify(body) : ''),
    headers: new Headers(),
    redirected: false,
    statusText: status === 200 ? 'OK' : 'Error',
    type: 'basic' as ResponseType,
    url: '',
    clone: () => null as any,
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as Response);
}

describe('AccessServiceClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    accessCircuit.reset();
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() =>
      mockFetchResponse(200, {}),
    );
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  describe('getDailyStats', () => {
    it('should return stats from access-service', async () => {
      fetchMock.mockImplementation(() =>
        mockFetchResponse(200, {
          active_inside: 15,
          today_entries: 42,
          today_exits: 10,
        }),
      );
      const result = await accessServiceClient.getDailyStats();
      expect(result).toEqual({
        active_inside: 15,
        today_entries: 42,
        today_exits: 10,
      });
    });

    it('should normalize camelCase fields as fallback', async () => {
      fetchMock.mockImplementation(() =>
        mockFetchResponse(200, {
          activeInside: 10,
          todayEntries: 30,
          todayExits: 5,
        }),
      );
      const result = await accessServiceClient.getDailyStats();
      expect(result).toEqual({
        active_inside: 10,
        today_entries: 30,
        today_exits: 5,
      });
    });

    it('should default to 0 for missing fields', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse(200, {}));
      const result = await accessServiceClient.getDailyStats();
      expect(result).toEqual({
        active_inside: 0,
        today_entries: 0,
        today_exits: 0,
      });
    });

    it('should propagate error on 5xx', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse(503));
      await expect(accessServiceClient.getDailyStats()).rejects.toThrow();
    });
  });

  describe('getPatronStatus', () => {
    it('should return current status from access-service', async () => {
      fetchMock.mockImplementation(() =>
        mockFetchResponse(200, { currentStatus: 'inside' }),
      );
      const result = await accessServiceClient.getPatronStatus('patron-123');
      expect(result).toBe('inside');
    });

    it('should fallback to outside on any error', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse(503));
      const result = await accessServiceClient.getPatronStatus('patron-123');
      expect(result).toBe('outside');
    });

    it('should return outside when circuit is open', async () => {
      jest.useFakeTimers();

      // 3 consecutive 5xx to open circuit
      fetchMock.mockImplementation(() => mockFetchResponse(503));
      for (let i = 0; i < 3; i++) {
        await accessServiceClient.getPatronStatus(`patron-${i}`);
      }

      // Circuit open — should return 'outside' WITHOUT calling fetch
      const fetchCountBefore = fetchMock.mock.calls.length;
      const result = await accessServiceClient.getPatronStatus('patron-circuit-open');
      expect(result).toBe('outside');
      expect(fetchMock.mock.calls.length).toBe(fetchCountBefore);

      jest.useRealTimers();
    });
  });

  describe('setPatronStatus', () => {
    it('should post status to access-service', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse(200));
      await accessServiceClient.setPatronStatus('patron-123', 'inside', 'cam-01');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/internal/access/patrons/patron-123/status'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"current_status":"inside"'),
        }),
      );
    });

    it('should throw error when circuit is open', async () => {
      jest.useFakeTimers();

      // 3 consecutive 5xx to open circuit
      fetchMock.mockImplementation(() => mockFetchResponse(503));
      for (let i = 0; i < 3; i++) {
        await accessServiceClient.getPatronStatus(`patron-${i}`);
      }

      // setPatronStatus should throw when circuit is open (fail-fast)
      const fetchCountBefore = fetchMock.mock.calls.length;
      await expect(
        accessServiceClient.setPatronStatus('patron-123', 'inside'),
      ).rejects.toThrow('Access-service temporarily unavailable');
      expect(fetchMock.mock.calls.length).toBe(fetchCountBefore);

      jest.useRealTimers();
    });

    it('should recover after cooldown', async () => {
      jest.useFakeTimers();

      // 3 failures to open
      fetchMock.mockImplementation(() => mockFetchResponse(503));
      for (let i = 0; i < 3; i++) {
        await accessServiceClient.getPatronStatus(`patron-${i}`);
      }

      // Advance past cooldown
      jest.advanceTimersByTime(30001);

      // Should recover and make the request
      fetchMock.mockImplementation(() => mockFetchResponse(200));
      await expect(
        accessServiceClient.setPatronStatus('patron-recovered', 'inside'),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
