import { nearestCopyBarcodes, findCopyByBarcode } from '../../utils/barcode';

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

describe('findCopyByBarcode', () => {
  const mockRepo = {
    getCopyByBarcode: jest.fn(),
  };

  beforeEach(() => {
    mockRepo.getCopyByBarcode.mockReset().mockResolvedValue(null);
  });

  it('returns exact match without extra lookups', async () => {
    const hit = { id: 'c1', barcode: 'LIB-9780140328721-001' };
    mockRepo.getCopyByBarcode.mockResolvedValue(hit);

    const result = await findCopyByBarcode(mockRepo, 'LIB-9780140328721-001');
    expect(result).toBe(hit);
    expect(mockRepo.getCopyByBarcode).toHaveBeenCalledTimes(1);
    expect(mockRepo.getCopyByBarcode).toHaveBeenCalledWith('LIB-9780140328721-001');
  });

  it('strips invisible control characters before lookup', async () => {
    const hit = { id: 'c1', barcode: 'LIB-9780140328721-001' };
    mockRepo.getCopyByBarcode.mockResolvedValue(hit);

    const result = await findCopyByBarcode(mockRepo, '\u001dLIB-9780140328721-001\r');
    expect(result).toBe(hit);
    expect(mockRepo.getCopyByBarcode).toHaveBeenCalledWith('LIB-9780140328721-001');
  });

  it('normalizes padded sequence (LIB-...-1 <-> LIB-...-001)', async () => {
    const hit = { id: 'c1', barcode: 'LIB-9780140328721-001' };
    mockRepo.getCopyByBarcode
      .mockResolvedValueOnce(null)   // raw LIB-...-1 not found
      .mockResolvedValueOnce(hit);   // normalized LIB-...-001 found

    const result = await findCopyByBarcode(mockRepo, 'LIB-9780140328721-1');
    expect(result).toBe(hit);
    expect(mockRepo.getCopyByBarcode).toHaveBeenCalledWith('LIB-9780140328721-001');
  });

  it('finds ISBN-10 copy when ISBN-13 barcode is scanned', async () => {
    // ISBN-13 9780140328721 converts to ISBN-10 0140328726
    const hit = { id: 'c1', barcode: 'LIB-0140328726-001' };
    mockRepo.getCopyByBarcode.mockImplementation(async (barcode: string) => {
      if (barcode === 'LIB-0140328726-001') return hit;
      return null;
    });

    const result = await findCopyByBarcode(mockRepo, 'LIB-9780140328721-001');
    expect(result).toBe(hit);
    expect(mockRepo.getCopyByBarcode).toHaveBeenCalledWith('LIB-0140328726-001');
  });

  it('finds ISBN-13 copy when ISBN-10 barcode is scanned', async () => {
    // ISBN-10 0140328726 converts to ISBN-13 9780140328721
    const hit = { id: 'c1', barcode: 'LIB-9780140328721-001' };
    mockRepo.getCopyByBarcode.mockImplementation(async (barcode: string) => {
      if (barcode === 'LIB-9780140328721-001') return hit;
      return null;
    });

    const result = await findCopyByBarcode(mockRepo, 'LIB-0140328726-001');
    expect(result).toBe(hit);
    expect(mockRepo.getCopyByBarcode).toHaveBeenCalledWith('LIB-9780140328721-001');
  });

  it('returns null when no format matches', async () => {
    mockRepo.getCopyByBarcode.mockResolvedValue(null);

    const result = await findCopyByBarcode(mockRepo, 'LIB-9999999999999-999');
    expect(result).toBeNull();
  });

  it('does not attempt ISBN conversion when barcode is not LIB-prefixed', async () => {
    const hit = { id: 'c1', barcode: 'GLUED9780140328721001' };
    mockRepo.getCopyByBarcode.mockResolvedValue(hit);

    const result = await findCopyByBarcode(mockRepo, '9780140328721001');
    expect(result).toBe(hit);
    // glued candidates path handles non-LIB codes; LIB-isbn path should not fire
    const isbnConvertCalls = mockRepo.getCopyByBarcode.mock.calls
      .filter(([arg]) => typeof arg === 'string' && arg.startsWith('LIB-0140328726'));
    expect(isbnConvertCalls).toHaveLength(0);
  });
});
