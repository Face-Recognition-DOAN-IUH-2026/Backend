import { nearestCopyBarcodes } from '../../utils/barcode';

describe('nearestCopyBarcodes', () => {
  const existing = [
    'LIB-9780140328721-001',
    'LIB-9780140328721-029',
    'LIB-9780140328721-031',
    'LIB-9780140328721-050',
  ];

  it('suggests the closest sequence numbers to a missing copy', () => {
    expect(nearestCopyBarcodes('LIB-9780140328721-030', existing, 3)).toEqual([
      'LIB-9780140328721-029',
      'LIB-9780140328721-031',
      'LIB-9780140328721-050',
    ]);
  });

  it('matches regardless of dashes and padding in the scanned code', () => {
    expect(nearestCopyBarcodes('LIB9780140328721001', existing, 1)).toEqual([
      'LIB-9780140328721-001',
    ]);
  });

  it('returns an empty list when there is nothing to suggest from', () => {
    expect(nearestCopyBarcodes('LIB-9780140328721-030', [], 3)).toEqual([]);
  });

  it('returns an empty list when the scanned code has no sequence number', () => {
    expect(nearestCopyBarcodes('LIB-NOSEQ', existing, 3)).toEqual([]);
  });

  it('respects the max limit', () => {
    expect(nearestCopyBarcodes('LIB-9780140328721-030', existing, 2)).toHaveLength(2);
  });
});
