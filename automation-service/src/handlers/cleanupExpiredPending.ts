import { accessClient } from '../clients/serviceClients';

const DEFAULT_PENDING_TTL_SECONDS = 30;

export async function cleanupExpiredPending(config: Record<string, any>): Promise<any> {
  const ttlSeconds = config.pending_ttl_seconds || DEFAULT_PENDING_TTL_SECONDS;

  try {
    const result = await accessClient.cleanupExpiredPending(ttlSeconds);
    const cleaned = (result as any)?.cleaned ?? 0;
    return {
      checked: 1,
      cleaned,
      ttl_seconds: ttlSeconds,
      message: `Reverted ${cleaned} expired pending states (>${ttlSeconds}s)`,
    };
  } catch (err: any) {
    return {
      checked: 0,
      cleaned: 0,
      message: `Failed to cleanup expired pending states: ${err?.message || String(err)}`,
    };
  }
}
