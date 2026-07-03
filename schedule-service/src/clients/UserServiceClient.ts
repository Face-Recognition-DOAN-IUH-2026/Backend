import { config } from '../config';
import { NotFoundError, ServiceUnavailableError } from '../errors';
import { getServiceToken, CircuitBreaker, retryWithBackoff } from '../../../shared';

export interface StaffUser {
  id: string;
  fullName: string | null;
  email: string;
  role: string;
  status: string;
}

const circuit = new CircuitBreaker(5, 30_000);

export class UserServiceClient {
  private async getJson<T>(path: string): Promise<T> {
    if (!circuit.canRequest()) {
      console.error(`[UserServiceClient] Circuit breaker OPEN for ${path}`);
      throw new ServiceUnavailableError('user-service is temporarily unavailable');
    }

    try {
      return await retryWithBackoff(async () => {
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
