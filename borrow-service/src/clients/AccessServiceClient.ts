import { config } from '../config';
import { HttpError } from '../middlewares/errorHandler';
import { CircuitBreaker } from '../utils/circuitBreaker';

const circuit = new CircuitBreaker(3, 30_000);

export async function isPatronInside(patronId: string): Promise<boolean> {
  if (!circuit.canRequest()) {
    throw new HttpError(503, 'access-service is temporarily unavailable');
  }
  try {
    const res = await fetch(`${config.accessServiceUrl}/internal/access/patrons/${patronId}/status`, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status >= 500) {
      circuit.recordFailure();
      throw new HttpError(503, 'Cannot verify library access right now');
    }
    if (!res.ok) {
      throw new HttpError(503, 'Cannot verify library access right now');
    }
    const data = await res.json() as any;
    circuit.recordSuccess();
    return data.currentStatus === 'inside' || data.current_status === 'inside';
  } catch (error) {
    if (error instanceof HttpError) throw error;
    circuit.recordFailure();
    throw new HttpError(503, 'Cannot reach access-service');
  }
}
