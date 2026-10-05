// Shared barcode helpers for LIB-<isbn>-<seq> copy codes.
// Label printers may pad the sequence differently than the DB
// (e.g. LIB-<isbn>-0001 vs LIB-<isbn>-001), so lookups must tolerate both forms.
// Some labels also omit the LIB prefix entirely (glued <isbn><seq> digits).

import { convertIsbnFormat } from './isbn';

export function normalizeCopySeq(barcode: string): string {
  const match = barcode.trim().match(/^LIB[\s-]*(\d{10,13})[\s-]*0*(\d+)$/i);
  if (!match) return barcode;
  return `LIB-${match[1]}-${match[2].padStart(3, '0')}`;
}

// Scanners may prefix/suffix invisible control characters (GS1 FNC1, NUL, CR/LF).
// A NUL byte in a lookup string makes PostgreSQL reject the query (UTF8 byte sequence
// error -> HTTP 500), and a control-character prefix defeats every format match, so
// strip them before any comparison or query.
export function sanitizeBarcode(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

// <isbn><seq> glued without the LIB prefix: 9780140328721001 -> LIB-9780140328721-001.
// Splits at the ISBN-13 boundary (14-17 digits) or the ISBN-10 boundary (11-13 digits),
// and tries the checksum-converted ISBN form as well.
function gluedBarcodeCandidates(raw: string): string[] {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return [];
  const splits: Array<[string, string]> = [];
  if (digits.length >= 14 && digits.length <= 17) splits.push([digits.slice(0, 13), digits.slice(13)]);
  if (digits.length >= 11 && digits.length <= 13) splits.push([digits.slice(0, 10), digits.slice(10)]);
  const candidates: string[] = [];
  for (const [base, seq] of splits) {
    for (const isbn of [base, convertIsbnFormat(base)]) {
      if (isbn) candidates.push(normalizeCopySeq(`LIB-${isbn}-${seq}`));
    }
  }
  return candidates;
}

export async function findCopyByBarcode<T>(repo: { getCopyByBarcode(barcode: string): Promise<T | null> }, barcode: string): Promise<T | null> {
  const raw = sanitizeBarcode(barcode);
  const exact = await repo.getCopyByBarcode(raw);
  if (exact) return exact;
  const normalized = normalizeCopySeq(raw);
  if (normalized !== raw) {
    const hit = await repo.getCopyByBarcode(normalized);
    if (hit) return hit;
  }
  for (const candidate of gluedBarcodeCandidates(raw)) {
    const hit = await repo.getCopyByBarcode(candidate);
    if (hit) return hit;
  }
  return null;
}
