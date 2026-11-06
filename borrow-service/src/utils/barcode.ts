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

// Suggest the closest existing copy barcodes when a scanned copy code is missing.
// Copy sequences are not guaranteed contiguous (deleted/disposed copies leave
// gaps), so instead of asserting a 001..N range, rank by sequence distance.
export function nearestCopyBarcodes(scannedBarcode: string, existingBarcodes: string[], max = 3): string[] {
  const scannedSeq = extractCopySeq(scannedBarcode);
  if (scannedSeq === null) return [];
  return existingBarcodes
    .map((barcode) => ({ barcode, seq: extractCopySeq(barcode) }))
    .filter((entry): entry is { barcode: string; seq: number } => entry.seq !== null)
    .sort((a, b) => Math.abs(a.seq - scannedSeq) - Math.abs(b.seq - scannedSeq))
    .slice(0, Math.max(0, max))
    .map((entry) => entry.barcode);
}

function extractCopySeq(barcode: string): number | null {
  const match = barcode.replace(/[\s-]/g, '').match(/(\d+)$/);
  if (!match) return null;
  const seq = Number(match[1]);
  return Number.isFinite(seq) ? seq : null;
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

// LIB-<isbn>-<seq> with ISBN-10 <-> ISBN-13 conversion:
// LIB-9780140328721-001 (ISBN-13) <-> LIB-0140328726-001 (ISBN-10).
function libBarcodeIsbnCandidates(raw: string): string[] {
  const match = raw.match(/^LIB[\s-]*(\d{10,13})[\s-]*(\d+)$/i);
  if (!match) return [];
  const altIsbn = convertIsbnFormat(match[1]);
  if (!altIsbn) return [];
  return [normalizeCopySeq(`LIB-${altIsbn}-${match[2]}`)];
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
  for (const candidate of libBarcodeIsbnCandidates(raw)) {
    const hit = await repo.getCopyByBarcode(candidate);
    if (hit) return hit;
  }
  for (const candidate of gluedBarcodeCandidates(raw)) {
    const hit = await repo.getCopyByBarcode(candidate);
    if (hit) return hit;
  }
  return null;
}
