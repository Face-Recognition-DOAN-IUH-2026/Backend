import { Router, Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { Book } from '../entities/Book';
import { BorrowRecord } from '../entities/BorrowRecord';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { internalAuth } from '../middlewares/internal-auth';
import { publishEvent } from '../utils/eventPublisher';

const router = Router();
router.use(internalAuth);

const books = () => AppDataSource.getRepository(Book);
const records = () => AppDataSource.getRepository(BorrowRecord);

router.get('/overdue', async (_req: Request, res: Response) => {
  try {
    const overdue = await records().createQueryBuilder('record')
      .where('record.status = :status', { status: 'borrowed' })
      .andWhere('record.returnAt IS NULL')
      .andWhere('record.dueAt < :now', { now: new Date() })
      .leftJoinAndSelect('record.book', 'book')
      .orderBy('record.dueAt', 'ASC')
      .getMany();

    const serialized = overdue.map(r => ({
      id: r.id,
      patron_id: r.patronId,
      book_id: r.bookId,
      borrow_at: r.borrowAt,
      due_at: r.dueAt,
      status: r.status,
      shelf_location: r.shelfLocation,
      book: r.book ? {
        id: r.book.id,
        title: r.book.title,
        author: r.book.author,
        isbn: r.book.isbn,
        shelf_location: r.book.shelfLocation,
      } : undefined,
    }));

    res.json(serialized);
  } catch (error) {
    console.error('Error fetching overdue borrows:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.get('/patron/:patronId', async (req: Request, res: Response) => {
  const { patronId } = req.params;
  try {
    const activeBorrows = await records().find({
      where: { patronId, status: 'borrowed', returnAt: undefined as any },
      relations: { book: true },
      order: { dueAt: 'ASC' },
    });

    const serialized = activeBorrows.map(r => ({
      id: r.id,
      patron_id: r.patronId,
      book_id: r.bookId,
      borrow_at: r.borrowAt,
      due_at: r.dueAt,
      status: r.status,
      shelf_location: r.shelfLocation,
      book: r.book ? {
        id: r.book.id,
        title: r.book.title,
        author: r.book.author,
        isbn: r.book.isbn,
        shelf_location: r.book.shelfLocation,
      } : undefined,
    }));

    res.json(serialized);
  } catch (error) {
    console.error('Error fetching patron borrows:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.get('/shelves', async (req: Request, res: Response) => {
  const { book_id } = req.query;
  try {
    let shelfBooks: Book[];
    if (book_id) {
      const book = await books().findOne({ where: { id: book_id as string } });
      shelfBooks = book ? [book] : [];
    } else {
      shelfBooks = await books().find({ order: { shelfLocation: 'ASC' } });
    }

    const grouped: Record<string, any[]> = {};
    for (const book of shelfBooks) {
      const loc = book.shelfLocation || 'Unknown';
      if (!grouped[loc]) grouped[loc] = [];
      grouped[loc].push({
        id: book.id,
        title: book.title,
        author: book.author,
        isbn: book.isbn,
        shelf_location: book.shelfLocation,
        is_available: book.isAvailable,
      });
    }

    res.json(grouped);
  } catch (error) {
    console.error('Error fetching shelf data:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.get('/books/search', async (req: Request, res: Response) => {
  const { query } = req.query;
  try {
    const qb = books().createQueryBuilder('book');
    if (query) {
      qb.where('book.title ILIKE :q OR book.author ILIKE :q OR book.isbn ILIKE :q OR book.categories ILIKE :q', { q: `%${query}%` });
    }
    const results = await qb.orderBy('book.title', 'ASC').limit(20).getMany();

    const serialized = results.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      isbn: b.isbn,
      categories: b.categories,
      shelf_location: b.shelfLocation,
      is_available: b.isAvailable,
    }));

    res.json(serialized);
  } catch (error) {
    console.error('Error searching books:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.post('/return', async (req: Request, res: Response) => {
  const { barcode } = req.body;
  try {
    if (!barcode) {
      res.status(400).json({ success: false, detail: 'barcode is required' });
      return;
    }

    const record = await records().findOne({
      where: { copy: { barcode } as any, status: 'borrowed' as any },
      relations: { book: true, copy: true },
    });

    if (!record) {
      res.status(404).json({ success: false, detail: 'Không tìm thấy phiếu mượn với barcode này hoặc sách đã được trả.' });
      return;
    }

    record.returnAt = new Date();
    record.status = 'returned';
    await records().save(record);

    if (record.copy) {
      record.copy.isAvailable = true;
      await AppDataSource.getRepository('BookCopy').save(record.copy);
    }

    // Publish book.returned event for automation-service
    publishEvent('book.returned', {
      bookId: record.bookId,
      title: record.book?.title,
      patronId: record.patronId,
      barcode,
    });

    res.json({
      success: true,
      message: 'Trả sách thành công',
      data: {
        record_id: record.id,
        book_title: record.book?.title,
        patron_id: record.patronId,
        returned_at: record.returnAt,
      },
    });
  } catch (error) {
    console.error('Error returning book:', error);
    res.status(500).json({ success: false, detail: 'Internal server error' });
  }
});

router.post('/renew', async (req: Request, res: Response) => {
  const { recordId } = req.body;
  try {
    if (!recordId) {
      res.status(400).json({ success: false, detail: 'recordId is required' });
      return;
    }

    const record = await records().findOne({
      where: { id: recordId, status: 'borrowed' as any },
      relations: { book: true },
    });

    if (!record) {
      res.status(404).json({ success: false, detail: 'Không tìm thấy phiếu mượn hoặc sách đã được trả.' });
      return;
    }

    const currentDue = new Date(record.dueAt);
    const now = new Date();
    if (currentDue <= now) {
      res.status(400).json({ success: false, detail: 'Phiếu mượn đã quá hạn, không thể gia hạn.' });
      return;
    }

    const newDue = new Date(currentDue);
    newDue.setDate(newDue.getDate() + 14);
    record.dueAt = newDue;
    await records().save(record);

    res.json({
      success: true,
      message: 'Gia hạn thành công',
      data: {
        record_id: record.id,
        book_title: record.book?.title,
        patron_id: record.patronId,
        old_due_at: currentDue.toISOString(),
        new_due_at: record.dueAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error renewing borrow:', error);
    res.status(500).json({ success: false, detail: 'Internal server error' });
  }
});

router.post('/batch-return', async (req: Request, res: Response) => {
  const { barcodes } = req.body;
  try {
    if (!Array.isArray(barcodes) || barcodes.length === 0) {
      res.status(400).json({ success: false, detail: 'barcodes array is required' });
      return;
    }

    const results: any[] = [];
    for (const barcode of barcodes) {
      const record = await records().findOne({
        where: { copy: { barcode } as any, status: 'borrowed' as any },
        relations: { book: true, copy: true },
      });

      if (!record) {
        results.push({ barcode, success: false, detail: 'Không tìm thấy phiếu mượn' });
        continue;
      }

      record.returnAt = new Date();
      record.status = 'returned';
      await records().save(record);

      if (record.copy) {
        record.copy.isAvailable = true;
        await AppDataSource.getRepository('BookCopy').save(record.copy);
      }

      // Publish book.returned event for automation-service
      publishEvent('book.returned', {
        bookId: record.bookId,
        title: record.book?.title,
        patronId: record.patronId,
        barcode,
      });

      results.push({
        barcode,
        success: true,
        record_id: record.id,
        book_title: record.book?.title,
        returned_at: record.returnAt,
      });
    }

    res.json({
      success: true,
      message: `Đã trả ${results.filter(r => r.success).length}/${barcodes.length} cuốn sách`,
      data: results,
    });
  } catch (error) {
    console.error('Error batch returning books:', error);
    res.status(500).json({ success: false, detail: 'Internal server error' });
  }
});

router.post('/books', async (req: Request, res: Response) => {
  try {
    const { isbn, title, author, quantity, shelf_location, categories, description, cover_url } = req.body;

    if (!isbn || !title) {
      res.status(400).json({ success: false, detail: 'isbn and title are required' });
      return;
    }

    const repo = new BorrowRepository();
    const existing = await books().findOne({ where: { isbn } });

    if (existing) {
      res.status(409).json({ 
        success: false, 
        detail: `Sách với ISBN ${isbn} đã tồn tại trong hệ thống`,
        data: { book_id: existing.id, title: existing.title }
      });
      return;
    }

    const upserted = await repo.upsertBook(isbn, title, author || null, cover_url || null, {
      categories: categories || null,
      description: description || null,
    });

    const book = upserted.book;
    const qty = Math.max(quantity || 1, 1);
    const barcodes = Array.from({ length: qty }, (_, i) => `LIB-${isbn}-${String(i + 1).padStart(3, '0')}`);

    if (shelf_location) {
      book.shelfLocation = shelf_location;
      await books().save(book);
    }

    const copies = await repo.createCopiesBatchWithSkip(book.id, barcodes, shelf_location || undefined);

    res.json({
      success: true,
      message: `Đã thêm sách "${book.title}" với ${copies.length} bản sao`,
      data: {
        book_id: book.id,
        title: book.title,
        author: book.author,
        isbn: book.isbn,
        shelf_location: book.shelfLocation,
        quantity: copies.length,
        barcodes,
      },
    });
  } catch (error) {
    console.error('Error creating book:', error);
    res.status(500).json({ success: false, detail: 'Internal server error' });
  }
});

router.put('/books/:book_id/quantity', async (req: Request, res: Response) => {
  try {
    const { book_id } = req.params;
    const { quantity } = req.body;

    if (quantity === undefined || typeof quantity !== 'number' || quantity < 1) {
      res.status(400).json({ success: false, detail: 'quantity must be a positive number' });
      return;
    }

    const book = await books().findOne({ where: { id: book_id } });
    if (!book) {
      res.status(404).json({ success: false, detail: 'Không tìm thấy sách' });
      return;
    }

    const repo = new BorrowRepository();
    const total = await repo.countCopies(book.id);
    const available = await repo.countCopies(book.id, true);
    const borrowed = total - available;

    if (quantity < borrowed) {
      res.status(400).json({ 
        success: false, 
        detail: `Không thể giảm xuống ${quantity}. Hiện có ${borrowed} bản đang được mượn` 
      });
      return;
    }

    if (quantity > total) {
      const offset = await repo.getMaxBarcodeNumberForBook(book);
      const barcodes = Array.from({ length: quantity - total }, (_, i) => `LIB-${book.isbn}-${String(offset + i + 1).padStart(3, '0')}`);
      await repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
    } else if (quantity < total) {
      const copies = await repo.getAvailableCopiesByBarcodeDesc(book.id);
      await repo.deleteCopies(copies.slice(0, total - quantity));
    }

    const nextTotal = await repo.countCopies(book.id);
    const nextAvailable = await repo.countCopies(book.id, true);

    res.json({
      success: true,
      message: `Đã cập nhật số lượng sách "${book.title}" từ ${total} xuống ${nextTotal}`,
      data: {
        book_id: book.id,
        title: book.title,
        isbn: book.isbn,
        old_quantity: total,
        new_quantity: nextTotal,
        available: nextAvailable,
        borrowed,
      },
    });
  } catch (error) {
    console.error('Error updating book quantity:', error);
    res.status(500).json({ success: false, detail: 'Internal server error' });
  }
});

router.get('/active-borrowers', async (_req: Request, res: Response) => {
  try {
    const overdue = await records().createQueryBuilder('record')
      .where('record.status = :status', { status: 'borrowed' })
      .andWhere('record.returnAt IS NULL')
      .leftJoinAndSelect('record.book', 'book')
      .getMany();

    const grouped = new Map<string, typeof overdue>();
    overdue.forEach((r) => {
      const list = grouped.get(r.patronId) || [];
      list.push(r);
      grouped.set(r.patronId, list);
    });

    const now = Date.now();
    const items: any[] = [];
    for (const [patronId, patronRecords] of grouped.entries()) {
      items.push({
        patron_id: patronId,
        total_borrowed: patronRecords.length,
        overdue_count: patronRecords.filter((r) => r.dueAt.getTime() < now).length,
      });
    }

    res.json({ items, total: items.length });
  } catch (error) {
    console.error('Error fetching active borrowers:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
