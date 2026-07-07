import { config } from '../config';
import { getServiceToken } from '../../../shared/auth';
import { CircuitBreaker } from '../../../shared/utils/circuitBreaker';

interface ActiveBorrowsResponse {
  hasActive: boolean;
  count: number;
}

export const borrowCircuit = new CircuitBreaker(3, 30_000);

export async function checkActiveBorrows(patronId: string): Promise<ActiveBorrowsResponse> {
  if (!borrowCircuit.canRequest()) {
    throw new Error('Borrow-service temporarily unavailable');
  }
  try {
    const res = await fetch(`${config.borrowServiceUrl}/borrow/internal/active-borrowers?patronId=${patronId}`, {
      headers: { 'Authorization': `Bearer ${getServiceToken('user-service', config.jwtSecret)}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 403) {
      throw new Error('Internal API key rejected by borrow-service');
    }
    if (!res.ok) {
      throw new Error(`Borrow-service returned ${res.status}`);
    }
    borrowCircuit.recordSuccess();
    return res.json() as Promise<ActiveBorrowsResponse>;
  } catch (err) {
    const isAuthError = err instanceof Error && err.message === 'Internal API key rejected by borrow-service';
    if (!isAuthError) {
      borrowCircuit.recordFailure();
      console.error('[BorrowServiceClient] Failed to check active borrows:', err);
      throw new Error('Cannot verify active borrows right now');
    }
    throw err;
  }
}
