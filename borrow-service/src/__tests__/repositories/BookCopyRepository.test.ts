import { BookCopyRepository } from '../../repositories/BookCopyRepository';
import { BookCopy } from '../../entities/BookCopy';
import { Book } from '../../entities/Book';

function buildCopy(overrides: Partial<BookCopy> = {}): BookCopy {
  return {
    id: 'copy-1',
    bookId: 'book-1',
    barcode: 'LIB-9780123456789-001',
    isAvailable: true,
    condition: 'good',
    status: 'available',
    shelfLocation: 'Kệ A-01-02',
    importedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    book: {
      id: 'book-1',
      isbn: '9780123456789',
      title: 'Clean Code',
      author: 'Robert C. Martin',
      shelfLocation: 'Kệ A-01-02',
    } as Book,
    ...overrides,
  } as BookCopy;
}

function makeRepo(options: { matchedIds?: string[]; copies?: BookCopy[] } = {}) {
  const copiesRepo: any = {
    query: jest.fn().mockResolvedValue((options.matchedIds ?? []).map((id) => ({ id }))),
    find: jest.fn().mockResolvedValue(options.copies ?? []),
  };
  const repo = new BookCopyRepository(copiesRepo, {} as any);
  return { repo, copiesRepo };
}

describe('BookCopyRepository.quickSearchCopies', () => {
  it('matches on book title/author/isbn and barcode with a wildcard pattern', async () => {
    const { repo, copiesRepo } = makeRepo({ matchedIds: ['copy-1'], copies: [buildCopy()] });

    await repo.quickSearchCopies('clean', 10);

    expect(copiesRepo.query).toHaveBeenCalledTimes(1);
    const [sql, params] = copiesRepo.query.mock.calls[0];
    // Books branch: trigram indexes on title / author / isbn.
    expect(sql).toMatch(/b\.title ILIKE \$1/);
    expect(sql).toMatch(/b\.author ILIKE \$1/);
    expect(sql).toMatch(/b\.isbn ILIKE \$1/);
    // Copies branch: trigram index on barcode, split out so the index is usable.
    expect(sql).toMatch(/c\.barcode ILIKE \$1/);
    expect(sql).toMatch(/UNION/);
    expect(sql).toMatch(/ORDER BY m\.is_available DESC, m\.title ASC/);
    expect(params).toEqual(['%clean%', 10]);
  });

  it('keeps the database ordering and loads copies with their book relation', async () => {
    const second = buildCopy({ id: 'copy-2' });
    const first = buildCopy({ id: 'copy-1' });
    const { repo, copiesRepo } = makeRepo({
      matchedIds: ['copy-2', 'copy-1'],
      copies: [first, second],
    });

    const rows = await repo.quickSearchCopies('clean');

    expect(copiesRepo.find).toHaveBeenCalledWith({
      where: { id: expect.anything() },
      relations: { book: true },
    });
    expect(rows.map((copy) => copy.id)).toEqual(['copy-2', 'copy-1']);
  });

  it('defaults to a limit of 10', async () => {
    const { repo, copiesRepo } = makeRepo();

    await repo.quickSearchCopies('abc');

    expect(copiesRepo.query.mock.calls[0][1]).toEqual(['%abc%', 10]);
  });

  it('returns an empty list without loading entities when nothing matches', async () => {
    const { repo, copiesRepo } = makeRepo({ matchedIds: [] });

    const rows = await repo.quickSearchCopies('khong-co-gi');

    expect(rows).toEqual([]);
    expect(copiesRepo.find).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from the search term', async () => {
    const { repo, copiesRepo } = makeRepo();

    await repo.quickSearchCopies('  Clean Code  ');

    expect(copiesRepo.query.mock.calls[0][1]).toEqual(['%Clean Code%', 10]);
  });
});
