import { config } from '../config';

interface ActiveBorrowsResponse {
  hasActive: boolean;
  count: number;
}

let consecutiveFailures = 0;
let openUntil = 0;

function canRequest(): boolean {
  return Date.now() >= openUntil;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  openUntil = 0;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= 3) {
    openUntil = Date.now() + 30_000;
  }
}

export async function checkActiveBorrows(patronId: string): Promise<ActiveBorrowsResponse> {
  if (!canRequest()) {
    throw new Error('Borrow-service temporarily unavailable');
  }
  try {
    const res = await fetch(`${config.borrowServiceUrl}/borrow/internal/patrons/${patronId}/active-borrows`, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 403) {
      throw new Error('Internal API key rejected by borrow-service');
    }
    if (!res.ok) {
      throw new Error(`Borrow-service returned ${res.status}`);
    }
    recordSuccess();
    return res.json() as Promise<ActiveBorrowsResponse>;
  } catch (err) {
    recordFailure();
    console.error('[BorrowServiceClient] Failed to check active borrows:', err);
    throw new Error('Cannot verify active borrows right now');
  }
}
