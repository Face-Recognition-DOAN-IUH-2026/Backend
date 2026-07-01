import { Router, Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { config } from '../config';
import { Book } from '../entities/Book';
import { BorrowRecord } from '../entities/BorrowRecord';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { WaitlistRepository } from '../repositories/WaitlistRepository';
import { createInternalAuth } from '../../shared';
import { publishEvent } from '../utils/eventPublisher';
import { fetchGoogleBooks } from '../clients/GoogleBooksClient';
import { In } from 'typeorm';
import { calculateOverdueFine } from '../utils/fineCalculator';
import { lookupPatronByStudentCode, lookupPatronById, PatronSummary } from '../clients/UserServiceClient';

const internalAuth = createInternalAuth({
  serviceName: 'borrow-service',
  jwtSecret: config.serviceJwtSecret,
});

const router = Router();
router.use(internalAuth);

const books = () => AppDataSource.getRepository(Book);
const records = () => AppDataSource.getRepository(BorrowRecord);

/**
 * @swagger
 * /borrow-internal/overdue:
 *   get:
 *     summary: List overdue borrows
 *     tags: [Borrow Internal]
 *     responses:
 *       200:
 *         description: List of overdue borrows
 */
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

/**
 * @swagger
 * /borrow-internal/due-soon:
 *   get:
 *     summary: List borrows due soon
 *     tags: [Borrow Internal]
 *     parameters:
 *       - in: query
 *         name: days_before
 *         schema:
 *           type: integer
 *           default: 3
 *     responses:
 *       200:
 *         description: List of due-soon borrows
 */
router.get('/due-soon', async (req: Request, res: Response) => {
  try {
    const daysBefore = parseInt(req.query.days_before as string) || 3;
    const now = new Date();
    const futureDate = new Date(now.getTime() + daysBefore * 24 * 60 * 60 * 1000);

    const dueSoon = await records().createQueryBuilder('record')
      .where('record.status = :status', { status: 'borrowed' })
      .andWhere('record.returnAt IS NULL')
      .andWhere('record.dueAt > :now', { now })
      .andWhere('record.dueAt <= :futureDate', { futureDate })
      .leftJoinAndSelect('record.book', 'book')
      .orderBy('record.dueAt', 'ASC')
      .getMany();

    const serialized = dueSoon.map(r => ({
      id: r.id,
      patron_id: r.patronId,
      book_id: r.bookId,
      borrow_at: r.borrowAt,
      due_at: r.dueAt,
      status: r.status,
      book: r.book ? {
        id: r.book.id,
        title: r.book.title,
        author: r.book.author,
        isbn: r.book.isbn,
      } : undefined,
    }));

    res.json(serialized);
  } catch (error) {
    console.error('Error fetching due-soon borrows:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * @swagger
 * /borrow-internal/patron/{patronId}:
 *   get:
 *     summary: Get active borrows by patron ID
 *     tags: [Borrow Internal]
 *     parameters:
 *       - in: path
 *         name: patronId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of active borrows
 */
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

/**
 * @swagger
 * /borrow-internal/patrons/:studentCode/history:
 *   get:
 *     summary: Get borrow history by student code (internal, no role check)
 *     tags: [Borrow Internal]
 *     parameters:
 *       - in: path
 *         name: studentCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Borrow history
 */
router.get('/patrons/:studentCode/history', async (req: Request, res: Response) => {
  try {
    const raw = await lookupPatronByStudentCode(req.params.studentCode);
    const patronId = raw.id;
    const statusFilter = req.query.status_filter as string | undefined;
    const borrowRecords = await new BorrowRepository().getBorrowsByPatron(patronId, statusFilter);

    const serialized = borrowRecords.map((r: any) => ({
      id: r.id,
      patron_id: r.patronId,
      patron_name: raw.full_name || raw.fullName || null,
      book_id: r.bookId,
      isbn: r.book?.isbn || '',
      borrow_at: r.borrowAt,
      due_at: r.dueAt,
      return_at: r.returnAt,
      status: r.status,
      shelf_location: r.shelfLocation,
      book: r.book ? {
        id: r.book.id,
        title: r.book.title,
        author: r.book.author,
        isbn: r.book.isbn,
        category: r.book.categories,
        cover_url: r.book.coverUrl,
      } : undefined,
    }));

    res.json(serialized);
  } catch (error) {
    console.error('Error fetching patron history:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * @swagger
 * /borrow-internal/patrons/id/:patronId/history:
 *   get:
 *     summary: Get borrow history by patron UUID (internal, no role check)
 *     tags: [Borrow Internal]
 *     parameters:
 *       - in: path
 *         name: patronId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Borrow history
 */
router.get('/patrons/id/:patronId/history', async (req: Request, res: Response) => {
  try {
    const patron = await lookupPatronById(req.params.patronId);
    if (!patron) {
      res.status(404).json({ detail: 'Patron not found' });
      return;
    }
    const statusFilter = req.query.status_filter as string | undefined;
    const borrowRecords = await new BorrowRepository().getBorrowsByPatron(req.params.patronId, statusFilter);

    const serialized = borrowRecords.map((r: any) => ({
      id: r.id,
      patron_id: r.patronId,
      patron_name: patron.full_name || patron.fullName || null,
      student_code: patron.student_code || patron.studentCode || null,
      book_id: r.bookId,
      isbn: r.book?.isbn || '',
      borrow_at: r.borrowAt,
      due_at: r.dueAt,
      return_at: r.returnAt,
      status: r.status,
      shelf_location: r.shelfLocation,
      book: r.book ? {
        id: r.book.id,
        title: r.book.title,
        author: r.book.author,
        isbn: r.book.isbn,
        category: r.book.categories,
        cover_url: r.book.coverUrl,
      } : undefined,
    }));

    res.json(serialized);
  } catch (error) {
    console.error('Error fetching patron history by ID:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * @swagger
 * /borrow-internal/shelves:
 *   get:
 *     summary: Get shelf layout
 *     tags: [Borrow Internal]
 *     parameters:
 *       - in: query
 *         name: book_id
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Shelf layout grouped by location
 */
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

/**
 * @swagger
 * /borrow-internal/books/search:
 *   get:
 *     summary: Search books (internal)
 *     tags: [Borrow Internal]
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Search results
 */
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

/**
 * @swagger
 * /borrow-internal/books/lookup:
 *   get:
 *     summary: Lookup book by ISBN or query
 *     tags: [Borrow Internal]
 *     parameters:
 *       - in: query
 *         name: isbn
 *         schema:
 *           type: string
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Book lookup result
 */
router.get('/books/lookup', async (req: Request, res: Response) => {
  const { isbn, query } = req.query;
  try {
    const searchValue = (isbn || query || '').toString().trim();
    if (!searchValue) {
      res.status(400).json({ success: false, detail: 'isbn or query is required' });
      return;
    }

    const existing = await books().findOne({ where: { isbn: searchValue } });
    if (existing) {
      res.json({
        success: true,
        source: 'database',
        data: {
          id: existing.id,
          title: existing.title,
          author: existing.author,
          isbn: existing.isbn,
          categories: existing.categories,
          description: existing.description,
          cover_url: existing.coverUrl,
          shelf_location: existing.shelfLocation,
          is_available: existing.isAvailable,
        },
      });
      return;
    }

    const googleData = await fetchGoogleBooks(searchValue);
    if (googleData) {
      res.json({
        success: true,
        source: 'google_books',
        data: {
          title: googleData.title,
          author: googleData.author,
          isbn: googleData.isbn13 || googleData.isbn10 || searchValue,
          categories: googleData.categories,
          description: googleData.description,
          cover_url: googleData.coverUrl,
          publisher: googleData.publisher,
          published_date: googleData.publishedDate,
          page_count: googleData.pageCount,
          language: googleData.language,
        },
      });
      return;
    }

    res.json({ success: false, source: 'not_found', data: null });
  } catch (error) {
    console.error('Error looking up book:', error);
    res.status(500).json({ success: false, detail: 'Internal server error' });
  }
});

/**
 * @swagger
 * /borrow-internal/return:
 *   post:
 *     summary: Return book by barcode (internal)
 *     tags: [Borrow Internal]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode]
 *             properties:
 *               barcode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Return successful
 */
router.post('/return', async (req: Request, res: Response) => {
  const { barcode } = req.body;
  try {
    if (!barcode) {
      res.status(400).json({ success: false, detail: 'barcode is required' });
      return;
    }

    const result = await AppDataSource.transaction(async (manager) => {
      const record = await manager.findOne(BorrowRecord, {
        where: { copy: { barcode } as any, status: 'borrowed' as any },
        relations: { book: true, copy: true },
      });

      if (!record) {
        throw new Error('NOT_FOUND');
      }

      const now = new Date();
      record.returnAt = now;
      record.status = 'returned';

      if (now > new Date(record.dueAt)) {
        const overdueMs = now.getTime() - new Date(record.dueAt).getTime();
        const overdueDays = Math.ceil(overdueMs / (1000 * 60 * 60 * 24));
        record.fineAmount = overdueDays * config.finePerDay;
      }

      await manager.save(record);

      if (record.copy) {
        record.copy.isAvailable = true;
        await manager.save(record.copy);
      }

      return record;
    });

    if (result === null) {
      res.status(404).json({ success: false, detail: 'Không tìm thấy phiếu mượn với barcode này hoặc sách đã được trả.' });
      return;
    }

    publishEvent('book.returned', {
      bookId: result.bookId,
      title: result.book?.title,
      patronId: result.patronId,
      barcode,
      fineAmount: result.fineAmount || 0,
    });

    if (result.fineAmount && result.fineAmount > 0) {
      publishEvent('fine.incurred', {
        patronId: result.patronId,
        bookTitle: result.book?.title,
        fineAmount: result.fineAmount,
        daysOverdue: Math.ceil((new Date(result.returnAt!).getTime() - new Date(result.dueAt).getTime()) / (1000 * 60 * 60 * 24)),
        borrowRecordId: result.id,
      });
    }

    res.json({
      success: true,
      message: result.fineAmount > 0 ? `Tra sach thanh cong. Phi phat: ${result.fineAmount.toLocaleString('vi-VN')}d` : 'Tra sach thanh cong',
      data: {
        record_id: result.id,
        book_title: result.book?.title,
        patron_id: result.patronId,
        returned_at: result.returnAt,
        fine_amount: result.fineAmount,
      },
    });
  } catch (error: any) {
    if (error?.message === 'NOT_FOUND') {
      res.status(404).json({ success: false, detail: 'Không tìm thấy phiếu mượn với barcode này hoặc sách đã được trả.' });
      return;
    }
    console.error('Error returning book:', error);
    res.status(500).json({ success: false, detail: 'Internal server error' });
  }
});

/**
 * @swagger
 * /borrow-internal/renew:
 *   post:
 *     summary: Renew a borrow (internal)
 *     tags: [Borrow Internal]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recordId]
 *             properties:
 *               recordId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Renewal successful
 */
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
      res.status(404).json({ success: false, detail: 'Khong tim thay phieu muon hoac sach da duoc tra.' });
      return;
    }

    if (record.renewalCount >= config.maxRenewals) {
      res.status(409).json({ success: false, detail: `Da dat gioi han gia han toi da ${config.maxRenewals} lan` });
      return;
    }

    const currentDue = new Date(record.dueAt);
    const now = new Date();
    if (currentDue <= now) {
      res.status(400).json({ success: false, detail: 'Phieu muon da qua han, khong the gia han.' });
      return;
    }

    const newDue = new Date(currentDue);
    newDue.setDate(newDue.getDate() + config.maxBorrowDays);
    record.dueAt = newDue;
    record.renewalCount = (record.renewalCount || 0) + 1;
    await records().save(record);

    res.json({
      success: true,
      message: `Gia han thanh cong (${record.renewalCount}/${config.maxRenewals})`,
      data: {
        record_id: record.id,
        book_title: record.book?.title,
        patron_id: record.patronId,
        old_due_at: currentDue.toISOString(),
        new_due_at: record.dueAt.toISOString(),
        renewal_count: record.renewalCount,
        max_renewals: config.maxRenewals,
      },
    });
  } catch (error) {
    console.error('Error renewing borrow:', error);
    res.status(500).json({ success: false, detail: 'Internal server error' });
  }
});

/**
 * @swagger
 * /borrow-internal/batch-return:
 *   post:
 *     summary: Batch return books by barcodes
 *     tags: [Borrow Internal]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcodes]
 *             properties:
 *               barcodes:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Batch return results
 */
router.post('/batch-return', async (req: Request, res: Response) => {
  const { barcodes } = req.body;
  try {
    if (!Array.isArray(barcodes) || barcodes.length === 0) {
      res.status(400).json({ success: false, detail: 'barcodes array is required' });
      return;
    }

    const results: any[] = [];

    await AppDataSource.transaction(async (manager) => {
      const matchedRecords = await manager.createQueryBuilder(BorrowRecord, 'record')
        .innerJoinAndSelect('record.copy', 'copy')
        .leftJoinAndSelect('record.book', 'book')
        .where('record.status = :status', { status: 'borrowed' })
        .andWhere('copy.barcode IN (:...barcodes)', { barcodes })
        .getMany();

      const barcodeToRecord = new Map<string, BorrowRecord>();
      for (const r of matchedRecords) {
        if (r.copy?.barcode) {
          barcodeToRecord.set(r.copy.barcode, r);
        }
      }

      const now = new Date();
      const recordsToSave: BorrowRecord[] = [];
      const copiesToSave: any[] = [];

      for (const barcode of barcodes) {
        const record = barcodeToRecord.get(barcode);

        if (!record) {
          results.push({ barcode, success: false, detail: 'Không tìm thấy phiếu mượn' });
          continue;
        }

        record.returnAt = now;
        record.status = 'returned';

        if (record.dueAt && now > new Date(record.dueAt)) {
          const overdueMs = now.getTime() - new Date(record.dueAt).getTime();
          const overdueDays = Math.ceil(overdueMs / (1000 * 60 * 60 * 24));
          record.fineAmount = calculateOverdueFine(overdueDays);
        }

        recordsToSave.push(record);

        if (record.copy) {
          record.copy.isAvailable = true;
          copiesToSave.push(record.copy);
        }

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

      if (recordsToSave.length > 0) {
        await manager.save(recordsToSave);
      }
      if (copiesToSave.length > 0) {
        await manager.save(copiesToSave);
      }
    });

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

/**
 * @swagger
 * /borrow-internal/books:
 *   post:
 *     summary: Create a new book
 *     tags: [Borrow Internal]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isbn, title]
 *             properties:
 *               isbn:
 *                 type: string
 *               title:
 *                 type: string
 *               author:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               shelf_location:
 *                 type: string
 *               categories:
 *                 type: string
 *               description:
 *                 type: string
 *               cover_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Book created
 */
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

/**
 * @swagger
 * /borrow-internal/books/{book_id}/quantity:
 *   put:
 *     summary: Update book copy quantity (internal)
 *     tags: [Borrow Internal]
 *     parameters:
 *       - in: path
 *         name: book_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity:
 *                 type: number
 *     responses:
 *       200:
 *         description: Quantity updated
 */
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

/**
 * @swagger
 * /borrow-internal/active-borrowers:
 *   get:
 *     summary: List active borrowers (internal)
 *     tags: [Borrow Internal]
 *     responses:
 *       200:
 *         description: List of active borrowers
 */
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

/**
 * @swagger
 * /borrow/internal/create:
 *   post:
 *     summary: Create borrow slip (internal, for AI agent)
 *     tags: [Borrow Internal]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [patronId, bookCopies]
 *             properties:
 *               patronId:
 *                 type: string
 *               bookCopies:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     bookCopyId:
 *                       type: string
 *                     dueDate:
 *                       type: string
 *     responses:
 *       200:
 *         description: Slip created
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { patronId, bookCopies } = req.body;

    if (!patronId || !bookCopies || !Array.isArray(bookCopies) || bookCopies.length === 0) {
      res.status(400).json({ success: false, detail: 'patronId and bookCopies are required' });
      return;
    }

    const repo = new BorrowRepository();
    const bookIds: string[] = [];
    const copyIds: (string | null)[] = [];
    const shelfLocations: (string | null)[] = [];

    for (const item of bookCopies) {
      const copyId = item.bookCopyId;
      if (!copyId) continue;

      const copy = await repo.getCopyById(copyId);
      if (!copy) {
        res.status(404).json({ success: false, detail: `Book copy ${copyId} not found` });
        return;
      }
      if (!copy.isAvailable) {
        res.status(409).json({ success: false, detail: `Book copy ${copyId} is already borrowed` });
        return;
      }

      const book = copy.book || await repo.getBookById(copy.bookId);
      if (!book) {
        res.status(404).json({ success: false, detail: 'Book not found for copy' });
        return;
      }

      const active = await repo.getActiveBorrowsByPatron(patronId);
      if (active.some((r) => r.bookId === book.id)) {
        res.status(409).json({ success: false, detail: `Book "${book.title}" is already borrowed by this patron` });
        return;
      }

      bookIds.push(book.id);
      copyIds.push(copy.id);
      shelfLocations.push(copy.shelfLocation || book.shelfLocation);
    }

    const overdue = await repo.getOverdueBorrows(patronId);
    if (overdue.length) {
      res.status(409).json({ success: false, detail: 'Patron has overdue borrows. Return them first.' });
      return;
    }

    const activeCount = await repo.countActiveBorrows(patronId);
    if (activeCount + bookIds.length > config.maxBorrowBooks) {
      res.status(409).json({ success: false, detail: `Exceeds max borrow limit (${config.maxBorrowBooks})` });
      return;
    }

    for (const copyId of copyIds) {
      if (copyId) {
        const copy = await repo.getCopyById(copyId);
        if (copy) await repo.setCopyAvailable(copy, false);
      }
    }

    const { slip, records } = await repo.createSlip(patronId, bookIds, copyIds, shelfLocations);

    for (let i = 0; i < records.length; i += 1) {
      records[i].book = (await repo.getBookById(bookIds[i]))!;
      records[i].copy = copyIds[i] ? await repo.getCopyById(copyIds[i]!) : null;
    }

    for (const record of records) {
      publishEvent('book.borrowed', {
        bookId: record.bookId,
        title: record.book?.title,
        patronId: record.patronId,
        borrowRecordId: record.id,
        dueAt: record.dueAt,
      });
    }

    res.json({
      success: true,
      slip,
      records,
    });
  } catch (error: any) {
    console.error('Error creating borrow slip:', error);
    if (error.statusCode) {
      res.status(error.statusCode).json({ success: false, detail: error.message });
    } else {
      res.status(500).json({ success: false, detail: 'Internal server error' });
    }
  }
});

router.get('/book/:bookId/waitlist', async (req: Request, res: Response) => {
  try {
    const { bookId } = req.params;
    const entries = await new WaitlistRepository().getWaitlistByBook(bookId);
    res.json(entries.map(e => ({
      id: e.id,
      book_id: e.bookId,
      patron_id: e.patronId,
      status: e.status,
      notified_at: e.notifiedAt,
      created_at: e.createdAt,
    })));
  } catch (error) {
    console.error('Error fetching waitlist:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.patch('/waitlist/batch-notify', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ detail: 'ids array is required' });
      return;
    }
    await new WaitlistRepository().markNotified(ids);
    res.json({ success: true, notified: ids.length });
  } catch (error) {
    console.error('Error marking waitlist notified:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
