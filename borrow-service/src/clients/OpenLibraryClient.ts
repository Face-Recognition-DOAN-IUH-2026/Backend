import { CircuitBreaker } from '../utils/circuitBreaker';

const circuit = new CircuitBreaker(3, 60_000);

export interface OpenLibraryMeta {
  title: string;
  author?: string | null;
  cover_url?: string | null;
}

export async function fetchOpenLibrary(isbn: string): Promise<OpenLibraryMeta | null> {
  if (!circuit.canRequest()) return null;
  try {
    const url = new URL('https://openlibrary.org/api/books');
    url.searchParams.set('bibkeys', `ISBN:${isbn}`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('jscmd', 'data');
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      circuit.recordFailure();
      return null;
    }
    const data = await res.json() as any;
    const book = data[`ISBN:${isbn}`];
    circuit.recordSuccess();
    if (!book) return null;
    return {
      title: book.title || `ISBN ${isbn}`,
      author: book.authors?.[0]?.name || null,
      cover_url: book.cover?.medium || book.cover?.small || null,
    };
  } catch {
    circuit.recordFailure();
    return null;
  }
}
