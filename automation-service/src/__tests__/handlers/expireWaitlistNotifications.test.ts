jest.mock('../../clients/serviceClients');

import { expireWaitlistNotifications } from '../../handlers/expireWaitlistNotifications';

describe('expireWaitlistNotifications (Deprecated)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns safe no-op response indicating deprecation', async () => {
    const result = await expireWaitlistNotifications({ expiryHours: 24 });
    expect(result.expired).toBe(0);
    expect(result.advanced).toBe(0);
    expect(result.message).toContain('Deprecated');
  });
});
