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

export class UserServiceClient {
  async getUser(id: string): Promise<UserSummary | null> {
    if (!circuit.canRequest()) return null;
    try {
      return await retryWithBackoff(async () => {
        const res = await fetch(`${config.userServiceUrl}/internal/users/${id}`, {
          headers: { 'Authorization': `Bearer ${getServiceToken('access-service', config.jwtSecret)}` },
          signal: AbortSignal.timeout(3000),
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

    if (!circuit.canRequest()) {
      const results = await Promise.all(uniqueIds.map((id) => this.getUser(id)));
      const map = new Map<string, UserSummary>();
      results.forEach((user) => {
        if (user?.id) map.set(user.id, user);
      });
      return map;
    }

    try {
      const res = await fetch(`${config.userServiceUrl}/internal/users/batch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getServiceToken('access-service', config.jwtSecret)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: uniqueIds }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status >= 500) {
        circuit.recordFailure();
        throw new Error(`user-service batch ${res.status}`);
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
      const results = await Promise.all(uniqueIds.map((id) => this.getUser(id)));
      const map = new Map<string, UserSummary>();
      results.forEach((user) => {
        if (user?.id) map.set(user.id, user);
      });
      return map;
    }
  }
}
