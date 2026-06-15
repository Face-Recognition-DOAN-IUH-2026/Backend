import { config } from '../config';
import { CircuitBreaker } from '../utils/circuitBreaker';

const circuit = new CircuitBreaker(3, 30_000);

export async function isPatronInside(patronId: string): Promise<boolean> {
  if (!circuit.canRequest()) return false;
  try {
    const res = await fetch(`${config.accessServiceUrl}/internal/access/patrons/${patronId}/status`, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = await res.json() as any;
    circuit.recordSuccess();
    return data.currentStatus === 'inside' || data.current_status === 'inside';
  } catch {
    circuit.recordFailure();
    return false;
  }
}
