import { checkActiveBorrows, borrowCircuit } from '../clients/BorrowServiceClient';

jest.unmock('../clients/BorrowServiceClient');
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

describe('BorrowServiceClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    borrowCircuit.reset();
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() =>
      mockFetchResponse(200, { hasActive: false, count: 0 }),
    );
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  describe('checkActiveBorrows', () => {
    it('should return ActiveBorrowsResponse on 2xx success', async () => {
      fetchMock.mockImplementation(() =>
        mockFetchResponse(200, { hasActive: true, count: 3 }),
      );
      const result = await checkActiveBorrows('patron-123');
      expect(result).toEqual({ hasActive: true, count: 3 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/borrow/internal/active-borrowers?patronId=patron-123'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should throw on 403 from borrow-service', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse(403));
      await expect(checkActiveBorrows('patron-123')).rejects.toThrow(
        'Internal API key rejected by borrow-service',
      );
    });

    it('should throw on 5xx from borrow-service', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse(503));
      await expect(checkActiveBorrows('patron-123')).rejects.toThrow(
        'Cannot verify active borrows right now',
      );
    });

    it('should open circuit after 3 consecutive 5xx errors and throw immediately', async () => {
      jest.useFakeTimers();

      fetchMock.mockImplementation(() => mockFetchResponse(503));

      // 3 failures to open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(checkActiveBorrows(`patron-${i}`)).rejects.toThrow(
          'Cannot verify active borrows right now',
        );
      }

      // 4th call — circuit open, should NOT call fetch
      const fetchCallCountBefore = fetchMock.mock.calls.length;
      await expect(checkActiveBorrows('patron-open')).rejects.toThrow(
        'Borrow-service temporarily unavailable',
      );
      expect(fetchMock.mock.calls.length).toBe(fetchCallCountBefore);

      jest.useRealTimers();
    });

    it('should recover circuit after cooldown period', async () => {
      jest.useFakeTimers();

      fetchMock.mockImplementation(() => mockFetchResponse(503));

      // 3 failures to open circuit
      for (let i = 0; i < 3; i++) {
        await expect(checkActiveBorrows(`patron-${i}`)).rejects.toThrow(
          'Cannot verify active borrows right now',
        );
      }

      // Advance time past cooldown (30s)
      jest.advanceTimersByTime(30001);

      // Now should recover and call fetch again
      fetchMock.mockImplementation(() =>
        mockFetchResponse(200, { hasActive: false, count: 0 }),
      );
      const result = await checkActiveBorrows('patron-recovered');
      expect(result).toEqual({ hasActive: false, count: 0 });
      expect(fetchMock).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should NOT count 4xx errors as circuit failures', async () => {
      jest.useFakeTimers();

      // 403 does NOT count as circuit failure
      fetchMock.mockImplementation(() => mockFetchResponse(403));
      for (let i = 0; i < 5; i++) {
        await expect(checkActiveBorrows(`patron-${i}`)).rejects.toThrow(
          'Internal API key rejected by borrow-service',
        );
      }

      // Circuit should still be closed — next call should attempt fetch
      fetchMock.mockImplementation(() => mockFetchResponse(200, { hasActive: false, count: 0 }));
      const result = await checkActiveBorrows('patron-still-working');
      expect(result).toEqual({ hasActive: false, count: 0 });

      jest.useRealTimers();
    });
  });
});
