import { config } from '../config';
import { NotFoundError, ServiceUnavailableError } from '../errors';
import { getServiceToken } from '../../../shared/auth';
import { CircuitBreaker } from '../../../shared/utils/circuitBreaker';
import { retryWithBackoff } from '../../../shared/utils/retryWithBackoff';

export interface StaffUser {
  id: string;
  fullName: string | null;
  email: string;
  role: string;
  status: string;
}

const circuit = new CircuitBreaker(5, 30_000);

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds

export class UserServiceClient {
  private cache = new Map<string, CacheEntry<any>>();

  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  private setInCache<T>(key: string, data: T, ttlMs = CACHE_TTL_MS): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  private async getJson<T>(path: string): Promise<T> {
    const cached = this.getFromCache<T>(path);
    if (cached !== undefined) {
      return cached;
    }

    if (!circuit.canRequest()) {
      console.error(`[UserServiceClient] Circuit breaker OPEN for ${path}`);
      throw new ServiceUnavailableError('user-service is temporarily unavailable');
    }

    try {
      const data = await retryWithBackoff(async () => {
        const url = `${config.userServiceUrl}${path}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          console.log(`[UserServiceClient] GET ${url}`);
          const start = Date.now();
          const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${getServiceToken('schedule-service', config.jwtSecret)}` },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          console.log(`[UserServiceClient] ${response.status} ${url} (${Date.now() - start}ms)`);
          if (response.status === 404) return null as T;
          if (response.status >= 500) {
            circuit.recordFailure();
            throw new Error(`user-service responded ${response.status}`);
          }
          if (!response.ok) throw new Error(`user-service responded ${response.status}`);
          circuit.recordSuccess();
          return await response.json() as T;
        } catch (err) {
          clearTimeout(timeout);
          console.error(`[UserServiceClient] ERROR ${url}: ${(err as Error).name}: ${(err as Error).message}`);
          throw err;
        }
      }, 2, 500);

      if (data !== undefined && data !== null) {
        this.setInCache(path, data);
      }
      return data;
    } catch (err) {
      throw new ServiceUnavailableError(`Cannot reach user-service: ${String(err)}`);
    }
  }

  async getStaff(id: string): Promise<StaffUser | null> {
    return this.getJson<StaffUser | null>(`/internal/users/${id}`);
  }

  async listStaff(ids?: string[]): Promise<StaffUser[]> {
    const query = ids?.length ? `?ids=${encodeURIComponent(ids.join(','))}` : '';
    return this.getJson<StaffUser[]>(`/internal/staff${query}`);
  }

  async requireActiveStaff(id: string): Promise<StaffUser> {
    const user = await this.getStaff(id);
    if (!user || !['staff', 'admin'].includes(user.role) || user.status !== 'active') {
      throw new NotFoundError('Staff not found or inactive');
    }
    return user;
  }
}
