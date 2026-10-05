import { ReturnService } from '../../services/ReturnService';
import { createMockBook, createMockCopy, createMockRecord, createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';
import { PATRON_UUID, STAFF_UUID } from '../helpers/auth';
import * as UserServiceClient from '../../clients/UserServiceClient';
import * as eventPublisher from '../../utils/eventPublisher';

let mockRepo: MockBorrowRepository;

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockRepo),
}));
jest.mock('../../utils/eventPublisher');

const mockUserService = UserServiceClient as jest.Mocked<typeof UserServiceClient>;
const mockPublishEvent = eventPublisher.publishEvent as jest.MockedFunction<typeof eventPublisher.publishEvent>;

const PATRON = {
  id: PATRON_UUID,
  student_code: 'SV001',
  full_name: 'Test Patron',
  email: 'patron@test.com',
};

beforeEach(() => {
  mockRepo = createMockBorrowRepository();
  (mockUserService.lookupPatronByStudentCode as jest.Mock).mockResolvedValue(PATRON);
});

function primeBarcodeReturn(condition?: string) {
  const book = createMockBook();
  const copy = createMockCopy();
  (copy as any).book = book;
  const record = createMockRecord({ bookId: book.id, copyId: copy.id });
  (record as any).book = book;
  mockRepo.getCopyByBarcode.mockResolvedValue(copy);
  mockRepo.getActiveBorrowByCopy.mockResolvedValue(record);
  mockRepo.countCopies.mockResolvedValue(1);
  return { book, copy, record };
}

describe('ReturnService.returnByBarcode — condition write-back', () => {
  it('records an explicit lost condition and hands it to the copy writer', async () => {
    const { copy, record } = primeBarcodeReturn();

    const result = await new ReturnService().returnByBarcode(copy.barcode, STAFF_UUID, 'staff@test.com', null, 'lost');

    expect(record.returnCondition).toBe('lost');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'lost', record, STAFF_UUID);
    expect(result.return_condition).toBe('lost');
    expect(result.status).toBe('returned');
  });

  it('defaults the condition to good when the caller omits it', async () => {
    const { copy, record } = primeBarcodeReturn();

    await new ReturnService().returnByBarcode(copy.barcode, STAFF_UUID, 'staff@test.com', null);

    expect(record.returnCondition).toBe('good');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'good', record, STAFF_UUID);
  });

  it.each(['new', 'minor_damage', 'major_damage', 'lost'])('accepts condition=%s', async (condition) => {
    const { copy, record } = primeBarcodeReturn();

    await new ReturnService().returnByBarcode(copy.barcode, STAFF_UUID, 'staff@test.com', null, condition);

    expect(record.returnCondition).toBe(condition);
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, condition, record, STAFF_UUID);
  });

  it('rejects an unknown condition with a 400 business error and writes nothing', async () => {
    const { copy } = primeBarcodeReturn();

    await expect(
      new ReturnService().returnByBarcode(copy.barcode, STAFF_UUID, 'staff@test.com', null, 'ruined'),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockRepo.returnBook).not.toHaveBeenCalled();
    expect(mockRepo.applyReturnToCopy).not.toHaveBeenCalled();
    expect(mockRepo.setCopyAvailable).not.toHaveBeenCalled();
  });

  it('keeps the existing book.returned event contract', async () => {
    const { book, copy, record } = primeBarcodeReturn();

    await new ReturnService().returnByBarcode(copy.barcode, STAFF_UUID, 'staff@test.com', null, 'minor_damage');

    expect(mockPublishEvent).toHaveBeenCalledWith('book.returned', expect.objectContaining({
      bookId: record.bookId,
      patronId: record.patronId,
      barcode: copy.barcode,
      fineAmount: 0,
    }));
  });

  it('throws 404 when the barcode is unknown', async () => {
    mockRepo.getCopyByBarcode.mockResolvedValue(null);

    await expect(
      new ReturnService().returnByBarcode('LIB-NOPE-001', STAFF_UUID, 'staff@test.com', null, 'good'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockRepo.applyReturnToCopy).not.toHaveBeenCalled();
  });
});

describe('ReturnService — scanned label format tolerance', () => {
  function primePaddedLabelReturn() {
    const book = createMockBook();
    const copy = createMockCopy();
    (copy as any).book = book;
    const record = createMockRecord({ bookId: book.id, copyId: copy.id });
    (record as any).book = book;
    const norm = (b: string) => b.replace(/[\s-]/g, '').toLowerCase();
    mockRepo.getCopyByBarcode.mockImplementation((barcode: string) =>
      Promise.resolve(norm(barcode) === norm(copy.barcode) ? (copy as any) : null),
    );
    mockRepo.getActiveBorrowByCopy.mockResolvedValue(record as any);
    mockRepo.countCopies.mockResolvedValue(1);
    return { book, copy, record };
  }

  it('returnByBarcode resolves LIB-...-0001 to the LIB-...-001 copy', async () => {
    const { copy, record } = primePaddedLabelReturn();

    const result = await new ReturnService().returnByBarcode('LIB-9780123456789-0001', STAFF_UUID, 'staff@test.com', null, 'good');

    expect(result.status).toBe('returned');
    expect(record.returnCondition).toBe('good');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'good', record, STAFF_UUID);
  });

  it('returnByPatron resolves the exact copy from a padded label barcode', async () => {
    primePaddedLabelReturn();

    const res = await new ReturnService().returnByPatron('SV001', 'LIB-9780123456789-0001', STAFF_UUID, 'staff@test.com', null, 'good');

    expect(res.status).toBe('returned');
    expect(mockRepo.getActiveBorrowByCopy).toHaveBeenCalledWith('cccccccc-cccc-cccc-cccc-cccccccccccc');
  });

  it('returnByPatron rejects when scanned copy barcode is not borrowed by patron even if patron borrowed another copy of same book', async () => {
    primePaddedLabelReturn();
    mockRepo.getCopyByBarcode.mockImplementation(async (barcode: string) => {
      if (barcode.includes('0002')) {
        return { id: 'copy-2-uuid', bookId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', barcode: 'LIB-9780123456789-0002' };
      }
      return null;
    });
    mockRepo.getActiveBorrowByCopy.mockImplementation(async (copyId: string) => {
      if (copyId === 'copy-2-uuid') {
        return null; // Not borrowed by this patron
      }
      return null;
    });

    await expect(
      new ReturnService().returnByPatron('SV001', 'LIB-9780123456789-0002', STAFF_UUID, 'staff@test.com', null, 'good'),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('không thuộc danh sách sách đang mượn'),
    });
  });

  it('returnByPatron sanitizes a NUL-laden ISBN before the book lookup', async () => {
    primePaddedLabelReturn();

    await expect(
      new ReturnService().returnByPatron('SV001', '9780123456789\u0000', STAFF_UUID, 'staff@test.com', null, 'good'),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockRepo.getBookByNormalizedIsbn).toHaveBeenCalledWith('9780123456789');
    expect(mockRepo.getBookByNormalizedIsbn).not.toHaveBeenCalledWith('9780123456789\u0000');
  });

  it('batchReturn resolves the exact copy from a padded label barcode', async () => {
    const { copy, record } = primePaddedLabelReturn();

    const res = await new ReturnService().batchReturn(
      'SV001',
      [{ barcode_or_isbn: 'LIB-9780123456789-0001', condition: 'good' }],
      STAFF_UUID,
      'staff@test.com',
    );

    expect(res.ok).toBe(1);
    expect(res.fail).toBe(0);
    expect(mockRepo.getActiveBorrowByCopy).toHaveBeenCalledWith(copy.id);
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'good', record, STAFF_UUID);
  });

  it('returnByBarcode resolves a glued ISBN+seq barcode without the LIB prefix', async () => {
    const { copy, record } = primePaddedLabelReturn();

    const result = await new ReturnService().returnByBarcode('9780123456789001', STAFF_UUID, 'staff@test.com', null, 'good');

    expect(result.status).toBe('returned');
    expect(record.returnCondition).toBe('good');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'good', record, STAFF_UUID);
  });

  it('returnByBarcode resolves a barcode with an invisible GS1 control-character prefix', async () => {
    const { copy, record } = primePaddedLabelReturn();

    const result = await new ReturnService().returnByBarcode('\u001dLIB-9780123456789-001', STAFF_UUID, 'staff@test.com', null, 'good');

    expect(result.status).toBe('returned');
    expect(record.returnCondition).toBe('good');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'good', record, STAFF_UUID);
  });
});

describe('ReturnService.returnByPatron — condition write-back', () => {
  it('records the condition on the matched record', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ bookId: book.id });
    (copy as any).book = book;
    const record = createMockRecord({ bookId: book.id, copyId: copy.id });
    (record as any).book = book;
    mockRepo.getBookByNormalizedIsbn.mockResolvedValue(book);
    mockRepo.getActiveBorrowsByPatronAndBook.mockResolvedValue([record]);
    mockRepo.getCopyById.mockResolvedValue(copy);
    mockRepo.countCopies.mockResolvedValue(1);

    await new ReturnService().returnByPatron('SV001', '9780123456789', STAFF_UUID, 'staff@test.com', null, 'major_damage');

    expect(record.returnCondition).toBe('major_damage');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'major_damage', record, STAFF_UUID);
  });

  it('defaults to good when omitted', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ bookId: book.id });
    (copy as any).book = book;
    const record = createMockRecord({ bookId: book.id, copyId: copy.id });
    (record as any).book = book;
    mockRepo.getBookByNormalizedIsbn.mockResolvedValue(book);
    mockRepo.getActiveBorrowsByPatronAndBook.mockResolvedValue([record]);
    mockRepo.getCopyById.mockResolvedValue(copy);
    mockRepo.countCopies.mockResolvedValue(1);

    await new ReturnService().returnByPatron('SV001', '9780123456789', STAFF_UUID, 'staff@test.com');

    expect(record.returnCondition).toBe('good');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'good', record, STAFF_UUID);
  });
});

describe('ReturnService.returnById — condition write-back', () => {
  it('records the condition when the record has a copy', async () => {
    const copy = createMockCopy();
    const record = createMockRecord({ copyId: copy.id });
    mockRepo.getBorrowRecordById.mockResolvedValue(record);
    mockRepo.getCopyById.mockResolvedValue(copy);
    mockRepo.countCopies.mockResolvedValue(1);

    await new ReturnService().returnById(record.id, STAFF_UUID, 'staff@test.com', null, 'new');

    expect(record.returnCondition).toBe('new');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'new', record, STAFF_UUID);
  });

  it('still records the condition on a copy-less record without touching a copy', async () => {
    const record = createMockRecord({ copyId: null as any });
    mockRepo.getBorrowRecordById.mockResolvedValue(record);

    await new ReturnService().returnById(record.id, STAFF_UUID, 'staff@test.com', null, 'minor_damage');

    expect(record.returnCondition).toBe('minor_damage');
    expect(mockRepo.applyReturnToCopy).not.toHaveBeenCalled();
    expect(mockRepo.returnBook).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing book.returned event contract without availableCopies', async () => {
    const book = createMockBook();
    const copy = createMockCopy();
    const record = createMockRecord({ copyId: copy.id });
    (record as any).book = book;
    mockRepo.getBorrowRecordById.mockResolvedValue(record);
    mockRepo.getCopyById.mockResolvedValue(copy);

    await new ReturnService().returnById(record.id, STAFF_UUID, 'staff@test.com', null, 'good');

    expect(mockPublishEvent).toHaveBeenCalledWith('book.returned', expect.objectContaining({
      bookId: record.bookId,
      patronId: record.patronId,
      fineAmount: 0,
    }));
  });
});

describe('ReturnService.batchReturn — independent conditions per item', () => {
  function primeBatch() {
    const bookA = createMockBook({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', isbn: '9780000000001' });
    const bookC = createMockBook({ id: 'cccccccc-0000-0000-0000-000000000000', isbn: '9780000000003' });
    const copyA = createMockCopy({ id: 'aaaaaaaa-0000-0000-0000-00000000000c', bookId: bookA.id });
    const copyC = createMockCopy({ id: 'cccccccc-0000-0000-0000-00000000000c', bookId: bookC.id });
    const recordA = createMockRecord({ id: 'aaaaaaaa-0000-0000-0000-00000000000r', bookId: bookA.id, copyId: copyA.id });
    const recordC = createMockRecord({ id: 'cccccccc-0000-0000-0000-00000000000r', bookId: bookC.id, copyId: copyC.id });
    (recordA as any).book = bookA;
    (recordC as any).book = bookC;

    mockRepo.getBookByNormalizedIsbn.mockImplementation((code: string) => {
      if (code === '9780000000001') return Promise.resolve(bookA);
      if (code === '9780000000003') return Promise.resolve(bookC);
      return Promise.resolve(null);
    });
    mockRepo.getActiveBorrowsByPatronAndBook.mockImplementation((_patronId: string, bookId: string) =>
      Promise.resolve(bookId === bookA.id ? [recordA] : bookId === bookC.id ? [recordC] : []),
    );
    mockRepo.getCopyById.mockImplementation((id: string) =>
      Promise.resolve(id === copyA.id ? copyA : id === copyC.id ? copyC : null),
    );
    mockRepo.countCopies.mockResolvedValue(1);

    return { bookA, bookC, copyA, copyC, recordA, recordC };
  }

  it('applies each item condition independently and keeps partial failures isolated', async () => {
    const { copyA, copyC, recordA, recordC } = primeBatch();

    const res = await new ReturnService().batchReturn(
      'SV001',
      [
        { barcode_or_isbn: '9780000000001', condition: 'lost' },
        { barcode_or_isbn: '9780000000002', condition: 'good' },
        { barcode_or_isbn: '9780000000003', condition: 'major_damage' },
      ],
      STAFF_UUID,
      'staff@test.com',
    );

    expect(res.ok).toBe(2);
    expect(res.fail).toBe(1);
    expect(res.results.map((r) => r.status)).toEqual(['success', 'failed', 'success']);

    expect(recordA.returnCondition).toBe('lost');
    expect(recordC.returnCondition).toBe('major_damage');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copyA, 'lost', recordA, STAFF_UUID);
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copyC, 'major_damage', recordC, STAFF_UUID);
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledTimes(2);
  });

  it('defaults every omitted item condition to good', async () => {
    primeBatch();

    const res = await new ReturnService().batchReturn(
      'SV001',
      [
        { barcode_or_isbn: '9780000000001' },
        { barcode_or_isbn: '9780000000003' },
      ],
      STAFF_UUID,
      'staff@test.com',
    );

    expect(res.ok).toBe(2);
    const conditions = (mockRepo.applyReturnToCopy as jest.Mock).mock.calls.map((c) => c[1]);
    expect(conditions).toEqual(['good', 'good']);
  });

  it('marks an item failed when its condition code is invalid without aborting the batch', async () => {
    primeBatch();

    const res = await new ReturnService().batchReturn(
      'SV001',
      [
        { barcode_or_isbn: '9780000000001', condition: 'bogus' },
        { barcode_or_isbn: '9780000000003', condition: 'new' },
      ],
      STAFF_UUID,
      'staff@test.com',
    );

    expect(res.results[0].status).toBe('failed');
    expect(res.results[1].status).toBe('success');
    expect(res.ok).toBe(1);
    expect(res.fail).toBe(1);
  });
});
