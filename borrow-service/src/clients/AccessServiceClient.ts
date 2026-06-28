import { config } from '../config';
import { HttpError } from '../middlewares/errorHandler';
import { CircuitBreaker } from '../utils/circuitBreaker';

const circuit = new CircuitBreaker(5, 60_000);

export interface PatronAccessStatus {
  inside: boolean;
  lastEntryAt: string | null;
  expiresAt: string | null;
  source: 'access-service' | 'user-service' | 'expired' | 'not-found';
  isExpired: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setAccessStatus(patronId: string, status: 'inside' | 'outside'): Promise<void> {
  await fetch(`${config.accessServiceUrl}/internal/access/patrons/${patronId}/status`, {
    method: 'POST',
    headers: {
      'x-internal-api-key': config.internalApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ current_status: status }),
    signal: AbortSignal.timeout(5000),
  });
}

async function getUserStatus(patronId: string): Promise<string | null> {
  try {
    const res = await fetch(`${config.userServiceUrl}/internal/users/${encodeURIComponent(patronId)}`, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.currentStatus || data.current_status || null;
  } catch {
    return null;
  }
}

function applyExpiry(status: PatronAccessStatus): PatronAccessStatus {
  if (!status.inside || !status.lastEntryAt) return status;

  const lastEntryAtMs = new Date(status.lastEntryAt).getTime();
  const expiresAtMs = lastEntryAtMs + config.maxEntryHours * 60 * 60 * 1000;
  const nowMs = Date.now();
  const isExpired = nowMs >= expiresAtMs;

  if (isExpired) {
    return {
      ...status,
      inside: false,
      expiresAt: new Date(expiresAtMs).toISOString(),
      source: 'expired',
      isExpired: true,
    };
  }

  return {
    ...status,
    expiresAt: new Date(expiresAtMs).toISOString(),
    isExpired: false,
  };
}

function buildFromAccessService(data: any): PatronAccessStatus {
  const lastEntryAt = data.lastEntryAt || data.last_entry_at || null;
  const inside = (data.currentStatus || data.current_status) === 'inside';

  return applyExpiry({
    inside,
    lastEntryAt,
    expiresAt: null,
    source: 'access-service',
    isExpired: false,
  });
}

async function buildFromUserService(patronId: string): Promise<PatronAccessStatus> {
  const userStatus = await getUserStatus(patronId);
  if (userStatus === 'inside') {
    return {
      inside: true,
      lastEntryAt: null,
      expiresAt: null,
      source: 'user-service',
      isExpired: false,
    };
  }
  return {
    inside: false,
    lastEntryAt: null,
    expiresAt: null,
    source: 'not-found',
    isExpired: false,
  };
}

export async function getPatronAccessStatus(patronId: string): Promise<PatronAccessStatus> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${config.accessServiceUrl}/internal/access/patrons/${patronId}/status`, {
        headers: { 'x-internal-api-key': config.internalApiKey },
        signal: AbortSignal.timeout(5000),
      });

      if (res.status === 404) {
        circuit.recordSuccess();
        return buildFromUserService(patronId);
      }

      if (res.ok) {
        circuit.recordSuccess();
        const data = await res.json() as any;
        return buildFromAccessService(data);
      }

      if (res.status >= 500) {
        circuit.recordFailure();
      }

      if (attempt < 3) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
    } catch (error) {
      circuit.recordFailure();
      if (attempt < 3) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
    }
  }

  return buildFromUserService(patronId);
}

export async function getPatronRawAccessStatus(patronId: string): Promise<PatronAccessStatus> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${config.accessServiceUrl}/internal/access/patrons/${patronId}/status`, {
        headers: { 'x-internal-api-key': config.internalApiKey },
        signal: AbortSignal.timeout(5000),
      });

      if (res.status === 404) {
        circuit.recordSuccess();
        return buildFromUserService(patronId);
      }

      if (res.ok) {
        circuit.recordSuccess();
        const data = await res.json() as any;
        const lastEntryAt = data.lastEntryAt || data.last_entry_at || null;
        const inside = (data.currentStatus || data.current_status) === 'inside';
        return applyExpiry({
          inside,
          lastEntryAt,
          expiresAt: null,
          source: 'access-service',
          isExpired: false,
        });
      }

      if (res.status >= 500) {
        circuit.recordFailure();
      }

      if (attempt < 3) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
    } catch (error) {
      circuit.recordFailure();
      if (attempt < 3) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
    }
  }

  return buildFromUserService(patronId);
}

export async function isPatronInside(patronId: string): Promise<boolean> {
  if (!circuit.canRequest()) {
    const userStatus = await getUserStatus(patronId);
    if (userStatus === 'inside') return true;
    throw new HttpError(503, 'access-service is temporarily unavailable');
  }

  try {
    const status = await getPatronAccessStatus(patronId);

    if (status.inside) {
      if (status.isExpired) return false;

      if (status.source === 'user-service') {
        await setAccessStatus(patronId, 'inside').catch(err => {
          console.error('[AccessServiceClient] Failed to set access status:', err);
          throw new Error(`Failed to update access status for patron ${patronId}`);
        });
      }
      return true;
    }

    if (status.source === 'user-service') {
      return false;
    }

    const userStatus = await getUserStatus(patronId);
    if (userStatus === 'inside') {
      await setAccessStatus(patronId, 'inside').catch(err => {
        console.error('[AccessServiceClient] Failed to set access status:', err);
        throw new Error(`Failed to update access status for patron ${patronId}`);
      });
      return true;
    }
    return false;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    circuit.recordFailure();
    const userStatus = await getUserStatus(patronId);
    if (userStatus === 'inside') return true;
    throw new HttpError(503, 'Cannot reach access-service');
  }
}