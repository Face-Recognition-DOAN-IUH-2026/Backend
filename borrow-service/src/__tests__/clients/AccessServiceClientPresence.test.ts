/**
 * BLF-PRES-01 — presence auto-touch: refresh last_entry_at on in-library
 * activity so the session does not expire mid-visit.
 *
 * NOTE: jest.setup.js automocks AccessServiceClient globally, so we use
 * jest.requireActual to test the real implementation. `fetch` is mocked
 * globally to avoid real network calls.
 */
const real = jest.requireActual('../../clients/AccessServiceClient');
const { setAccessStatus, touchPatronPresence, shouldTouchPresence } = real as any;

const PATRON_ID = 'patron-1';

describe('AccessServiceClient presence touch (BLF-PRES-01)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setAccessStatus', () => {
    it('POSTs current_status inside to access-service', async () => {
      fetchMock.mockResolvedValue({ ok: true } as Response);
      await setAccessStatus(PATRON_ID, 'inside');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain(`/internal/access/patrons/${PATRON_ID}/status`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ current_status: 'inside' });
    });
  });

  describe('touchPatronPresence', () => {
    it('calls setAccessStatus(patronId, inside)', async () => {
      fetchMock.mockResolvedValue({ ok: true } as Response);
      await touchPatronPresence(PATRON_ID);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
        current_status: 'inside',
      });
    });

    it('does not throw when access-service fails (best-effort)', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      await expect(touchPatronPresence(PATRON_ID)).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not throw when access-service returns non-ok', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
      await expect(touchPatronPresence(PATRON_ID)).resolves.toBeUndefined();
    });
  });

  describe('shouldTouchPresence', () => {
    it('returns true when lastEntryAt is null/undefined', () => {
      expect(shouldTouchPresence(null)).toBe(true);
      expect(shouldTouchPresence(undefined)).toBe(true);
    });

    it('returns true when lastEntryAt is older than cooldown', () => {
      const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
      expect(shouldTouchPresence(stale)).toBe(true);
    });

    it('returns false when lastEntryAt is within cooldown', () => {
      const recent = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
      expect(shouldTouchPresence(recent)).toBe(false);
    });

    it('returns false exactly at cooldown boundary', () => {
      const boundary = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // exactly 5 min
      expect(shouldTouchPresence(boundary)).toBe(false);
    });
  });
});
