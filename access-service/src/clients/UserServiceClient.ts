import { config } from '../config';

export interface UserSummary {
  id: string;
  fullName?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  studentCode?: string | null;
  cardNumber?: string | null;
}

export class UserServiceClient {
  private failures = 0;
  private openUntil = 0;

  private canRequest() {
    if (Date.now() < this.openUntil) return false;
    return true;
  }

  private recordSuccess() {
    this.failures = 0;
    this.openUntil = 0;
  }

  private recordFailure() {
    this.failures += 1;
    if (this.failures >= 3) {
      this.openUntil = Date.now() + 15_000;
    }
  }

  async getUser(id: string): Promise<UserSummary | null> {
    if (!this.canRequest()) return null;
    try {
      const res = await fetch(`${config.userServiceUrl}/internal/users/${id}`, {
        headers: { 'x-internal-api-key': config.internalApiKey },
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 404) {
        this.recordSuccess();
        return null;
      }
      if (!res.ok) throw new Error(`user-service ${res.status}`);
      this.recordSuccess();
      return (await res.json()) as UserSummary;
    } catch {
      this.recordFailure();
      return null;
    }
  }

  async getUsers(ids: string[]): Promise<Map<string, UserSummary>> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const users = await Promise.all(uniqueIds.map((id) => this.getUser(id)));
    const map = new Map<string, UserSummary>();
    users.forEach((user) => {
      if (user?.id) map.set(user.id, user);
    });
    return map;
  }
}
