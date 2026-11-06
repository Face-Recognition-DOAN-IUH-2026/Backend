import { config } from '../config';
import { getServiceToken } from '../../../shared/auth';
import { CircuitBreaker } from '../../../shared/utils/circuitBreaker';
import { retryWithBackoff } from '../../../shared/utils/retryWithBackoff';

export interface UserSummary {
  id: string;
  fullName?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  studentCode?: string | null;
  cardNumber?: string | null;
}

const circuit = new CircuitBreaker(5, 60_000);

/**
 * Timeout for the batch lookup. Kept short on purpose: a hung user-service must
 * not hold an access-service request open long enough to trip gateway/proxy
 * timeouts (the dashboard polls /api/access/* every 30s).
 */
const BATCH_TIMEOUT_MS = 3_000;

/** Timeout for a single-user lookup on the degraded fallback path. */
const SINGLE_TIMEOUT_MS = 1_500;

/** Upper bound for individual lookups issued by the degraded fallback path. */
const MAX_FALLBACK_LOOKUPS = 25;

/** Status codes meaning "the batch route is not deployed" (service version skew). */
const BATCH_ROUTE_MISSING_STATUSES = [404, 405];

export class UserServiceClient {
  async getUser(id: string, timeoutMs: number = 3000): Promise<UserSummary | null> {
    if (!circuit.canRequest()) return null;
    try {
      return await retryWithBackoff(async () => {
        const res = await fetch(`${config.userServiceUrl}/internal/users/${id}`, {
          headers: { 'Authorization': `Bearer ${getServiceToken('access-service', config.jwtSecret)}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 404) {
          circuit.recordSuccess();
          return null;
        }
        if (res.status >= 500) {
          circuit.recordFailure();
          throw new Error(`user-service ${res.status}`);
        }
        if (!res.ok) throw new Error(`user-service ${res.status}`);
        circuit.recordSuccess();
        return (await res.json()) as UserSummary;
      }, 2, 500);
    } catch {
      return null;
    }
  }

  async getUsers(ids: string[]): Promise<Map<string, UserSummary>> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();

    // Circuit open: user-service is known-bad. Degrade to "no user enrichment"
    // without issuing any outbound request.
    if (!circuit.canRequest()) return new Map();

    try {
      const res = await fetch(`${config.userServiceUrl}/internal/users/batch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getServiceToken('access-service', config.jwtSecret)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: uniqueIds }),
        signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
      });

      if (BATCH_ROUTE_MISSING_STATUSES.includes(res.status)) {
        // The deployed user-service does not expose the batch route → fall back
        // to individual lookups (bounded).
        return await this.getUsersIndividually(uniqueIds);
      }

      if (!res.ok) throw new Error(`user-service batch ${res.status}`);
      circuit.recordSuccess();
      const data = await res.json() as Record<string, UserSummary>;
      const map = new Map<string, UserSummary>();
      for (const [id, user] of Object.entries(data)) {
        if (user?.id) map.set(id, user);
      }
      return map;
    } catch {
      // Network error, timeout or 5xx. Do NOT fan out to one request per patron:
      // that N+1 storm took ~10s and could push the dashboard request past the
      // gateway/proxy timeout. Degrade to "no user enrichment" instead.
      circuit.recordFailure();
      return new Map();
    }
  }

  /** Degraded per-user lookup, used only when the batch route is unavailable. */
  private async getUsersIndividually(ids: string[]): Promise<Map<string, UserSummary>> {
    const limited = ids.slice(0, MAX_FALLBACK_LOOKUPS);
    const results = await Promise.all(limited.map((id) => this.getUser(id, SINGLE_TIMEOUT_MS)));
    const map = new Map<string, UserSummary>();
    results.forEach((user) => {
      if (user?.id) map.set(user.id, user);
    });
    return map;
  }
}
