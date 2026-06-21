import { config } from '../config';
import { HttpError } from '../middlewares/errorHandler';
import { CircuitBreaker } from '../utils/circuitBreaker';

const circuit = new CircuitBreaker(5, 60_000);

export interface PatronSummary {
  id: string;
  fullName?: string | null;
  full_name?: string | null;
  studentCode?: string | null;
  student_code?: string | null;
  email?: string | null;
  cardNumber?: string | null;
  card_number?: string | null;
  currentStatus?: string | null;
  current_status?: string | null;
}

async function request(path: string, init?: RequestInit) {
  if (!circuit.canRequest()) {
    throw new HttpError(503, 'user-service is temporarily unavailable');
  }
  try {
    const res = await fetch(`${config.userServiceUrl}${path}`, {
      ...init,
      headers: {
        'x-internal-api-key': config.internalApiKey,
        ...(init?.headers || {}),
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status >= 500) {
      circuit.recordFailure();
      throw new HttpError(503, 'Cannot lookup patron right now');
    }
    circuit.recordSuccess();
    return res;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    circuit.recordFailure();
    throw new HttpError(503, 'Khong the tra cuu doc gia');
  }
}

export async function lookupPatronByStudentCode(studentCode: string): Promise<PatronSummary> {
  const normalized = studentCode.trim();
  if (!normalized) throw new HttpError(400, 'student_code is required');
  const res = await request(`/patrons/lookup?student_code=${encodeURIComponent(normalized)}`);
  if (res.status !== 200) throw new HttpError(404, 'Khong tim thay doc gia');
  const data = await res.json() as any;
  if (!data.exists || !data.patron) throw new HttpError(404, 'Khong tim thay doc gia voi MSSV nay');
  return data.patron;
}

export async function lookupPatronById(id: string): Promise<PatronSummary | null> {
  const res = await request(`/users/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new HttpError(503, 'Cannot lookup patron right now');
  return res.json() as Promise<PatronSummary>;
}

export async function lookupPatronsByIds(ids: string[]): Promise<Map<string, PatronSummary>> {
  if (ids.length === 0) return new Map();
  const res = await request('/internal/users/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (res.status !== 200) throw new HttpError(503, 'Cannot batch lookup patrons');
  const data = await res.json() as Record<string, PatronSummary>;
  return new Map(Object.entries(data));
}
