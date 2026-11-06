/**
 * Regression tests for UserServiceClient resilience (access-service P0-2).
 *
 * Contract being locked in:
 *  - one batch call enriches many patron ids (no N+1 fan-out on the happy path)
 *  - when user-service is unreachable / failing / timing out, enrichment
 *    degrades to "no user data" instead of fanning out to N individual lookups
 *    (the old fallback issued 3 retries x N ids ≈ 10s and could push the
 *    dashboard request past gateway/proxy timeouts)
 *  - network failures open the circuit so repeated polls stop hammering
 *    user-service
 *  - the per-user fallback is only used when the batch route itself is missing
 *    (404/405 = version skew) and is bounded in size
 */

jest.mock('../../config', () => ({
  config: {
    userServiceUrl: 'http://user-service:3001',
    jwtSecret: 'test-secret',
  },
}));

// jest.setup.js mocks this client globally (stub returning an empty map).
// This suite must exercise the real implementation.
jest.unmock('../../clients/UserServiceClient');

type ClientModule = typeof import('../../clients/UserServiceClient');

/** Fresh module registry per test so the module-level circuit starts closed. */
function loadClient(): ClientModule {
  let mod!: ClientModule;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('../../clients/UserServiceClient');
  });
  return mod;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('UserServiceClient.getUsers — resilient enrichment', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves all patron ids with a single batch call', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        p1: { id: 'p1', fullName: 'Nguyen Van A' },
        p2: { id: 'p2', fullName: 'Tran Thi B' },
      }),
    );

    const { UserServiceClient } = loadClient();
    const users = await new UserServiceClient().getUsers(['p1', 'p2', 'p1', '']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/internal/users/batch');
    expect(users.get('p1')?.fullName).toBe('Nguyen Van A');
    expect(users.get('p2')?.fullName).toBe('Tran Thi B');
  });

  it('does not issue any call when there are no patron ids', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}));
    const { UserServiceClient } = loadClient();

    const users = await new UserServiceClient().getUsers(['', null as unknown as string]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(users.size).toBe(0);
  });

  it('does not fan out to individual lookups when user-service is unreachable', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const { UserServiceClient } = loadClient();
    const startedAt = Date.now();
    const users = await new UserServiceClient().getUsers(['p1', 'p2', 'p3']);
    const elapsed = Date.now() - startedAt;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(users.size).toBe(0);
    expect(elapsed).toBeLessThan(3000);
  });

  it('does not fan out to individual lookups when user-service returns 5xx', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 503));

    const { UserServiceClient } = loadClient();
    const users = await new UserServiceClient().getUsers(['p1', 'p2']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(users.size).toBe(0);
  });

  it('stops calling user-service once the circuit is open', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const { UserServiceClient } = loadClient();
    const client = new UserServiceClient();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await client.getUsers([`p${attempt}`]);
    }
    fetchSpy.mockClear();

    const users = await client.getUsers(['p-later']);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(users.size).toBe(0);
  });

  it('falls back to individual lookups only when the batch route is missing', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/batch')) return jsonResponse({}, 404);
      const id = url.split('/').pop() as string;
      return jsonResponse({ id, fullName: `Name ${id}` });
    });

    const { UserServiceClient } = loadClient();
    const users = await new UserServiceClient().getUsers(['p1', 'p2']);

    expect(users.get('p1')?.fullName).toBe('Name p1');
    expect(users.get('p2')?.fullName).toBe('Name p2');
    expect(fetchSpy.mock.calls.filter((call) => String(call[0]).includes('/batch'))).toHaveLength(1);
  });

  it('bounds the number of individual lookups used by the degraded fallback', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/batch')) return jsonResponse({}, 404);
      const id = url.split('/').pop() as string;
      return jsonResponse({ id, fullName: `Name ${id}` });
    });

    const ids = Array.from({ length: 50 }, (_, index) => `p${index}`);
    const { UserServiceClient } = loadClient();
    await new UserServiceClient().getUsers(ids);

    const individualCalls = fetchSpy.mock.calls.filter((call) => !String(call[0]).includes('/batch'));
    expect(individualCalls.length).toBeGreaterThan(0);
    expect(individualCalls.length).toBeLessThanOrEqual(25);
  });
});
