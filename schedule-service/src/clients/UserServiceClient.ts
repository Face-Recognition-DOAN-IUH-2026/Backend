import { config } from '../config';
import { NotFoundError, ServiceUnavailableError } from '../errors';

export interface StaffUser {
  id: string;
  fullName: string | null;
  email: string;
  role: string;
  status: string;
}

type CircuitState = 'closed' | 'open' | 'half_open';

export class UserServiceClient {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitState = 'closed';

  private canRequest() {
    if (this.state !== 'open') return true;
    if (Date.now() - this.openedAt > 30000) {
      this.state = 'half_open';
      return true;
    }
    return false;
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failures += 1;
    if (this.failures >= 3) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    if (!this.canRequest()) {
      throw new ServiceUnavailableError('user-service is temporarily unavailable');
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(`${config.userServiceUrl}${path}`, {
          headers: { 'x-internal-api-key': config.internalApiKey },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) {
          if (response.status === 404) return null as T;
          throw new Error(`user-service responded ${response.status}`);
        }
        this.onSuccess();
        return await response.json() as T;
      } catch (err) {
        clearTimeout(timeout);
        lastError = err;
      }
    }

    this.onFailure();
    throw new ServiceUnavailableError(`Cannot reach user-service: ${String(lastError)}`);
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
