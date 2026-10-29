import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { auth, AuthRequest, requireRole, requireDynamicPermission } from '../middlewares/auth';
import { HttpError } from '../../../shared/error-handler';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { fetchGoogleBooks } from '../clients/GoogleBooksClient';
import { serializeBook, serializeBookWithStats, serializeCopy } from '../services/serializers';
import { normalizeCondition, normalizeCopyStatus } from '../constants/copy';
import { Book } from '../entities/Book';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use(auth);

function normalizeRowValue(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeIsbnCell(cell: ExcelJS.Cell) {
  const raw = cell.text || normalizeRowValue(cell.value);
  return raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/\.0+$/, '');
}

export interface ParsedBookRow {
  isbn: string;
  quantity: number;
  price: number | null;
  title: string | null;
  author: string | null;
  publisher: string | null;
  publishedDate: string | null;
  categories: string | null;
  pageCount: number | null;
  shelfLocation: string | null;
  description: string | null;
  coverUrl: string | null;
  subtitle: string | null;
  line: number;
}

function parseExcelRows(buffer: Buffer): Promise<ParsedBookRow[]> {
  return new Promise(async (resolve, reject) => {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[0];
      if (!ws || ws.rowCount < 2) throw new HttpError(400, 'File Excel trong hoac khong co du lieu');
      const headerRow = ws.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell((cell, col) => { headers[col] = normalizeRowValue(cell.value).toUpperCase(); });

      const isbnCol = headers.findIndex((h) => !!h && h.includes('ISBN'));
      const qtyCol = headers.findIndex((h) => !!h && (h.includes('QUANTITY') || h.includes('QTY') || h.includes('SO LUONG') || h.includes('SỐ LƯỢNG') || h === 'SL'));
      const priceCol = headers.findIndex((h) => !!h && (
        h.includes('PRICE') || h.includes('GIA') || h.includes('GIÁ') || h.includes('DON GIA') || h.includes('ĐƠN GIÁ') || h.includes('COST')
      ));
      const titleCol = headers.findIndex((h) => !!h && (
        h.includes('TITLE') || h.includes('TEN SACH') || h.includes('TÊN SÁCH') || h.includes('TIEU DE') || h.includes('TIÊU ĐỀ') || h === 'NAME' || h === 'TEN' || h === 'TÊN'
      ));
      const authorCol = headers.findIndex((h) => !!h && (h.includes('AUTHOR') || h.includes('TAC GIA') || h.includes('TÁC GIẢ')));
      const publisherCol = headers.findIndex((h) => !!h && (
        h.includes('PUBLISHER') || h.includes('NXB') || h.includes('NHA XUAT BAN') || h.includes('NHÀ XUẤT BẢN')
      ));
      const pubDateCol = headers.findIndex((h) => !!h && (
        h.includes('PUBLISHED') || h.includes('YEAR') || h.includes('NAM XUAT BAN') || h.includes('NĂM XUẤT BẢN') || h.includes('NAM XB') || h.includes('NĂM XB')
      ));
      const catCol = headers.findIndex((h) => !!h && (
        h.includes('CATEGOR') || h.includes('THE LOAI') || h.includes('THỂ LOẠI') || h.includes('GENRE')
      ));
      const pageCol = headers.findIndex((h) => !!h && (
        h.includes('PAGE') || h.includes('SO TRANG') || h.includes('SỐ TRANG')
      ));
      const shelfCol = headers.findIndex((h) => !!h && (
        h.includes('SHELF') || h.includes('VI TRI') || h.includes('VỊ TRÍ') || h.includes('KE') || h.includes('KỆ')
      ));
      const descCol = headers.findIndex((h) => !!h && (
        h.includes('DESC') || h.includes('MO TA') || h.includes('MÔ TẢ') || h.includes('SUMMARY')
      ));
      const coverCol = headers.findIndex((h) => !!h && (
        h.includes('COVER') || h.includes('ANH BIA') || h.includes('ẢNH BÌA') || h.includes('IMAGE')
      ));
      const subCol = headers.findIndex((h) => !!h && (
        h.includes('SUBTITLE') || h.includes('PHU DE') || h.includes('PHỤ ĐỀ')
      ));

      if (isbnCol < 1) throw new HttpError(400, "File phai co cot 'ISBN'");

      const rows: ParsedBookRow[] = [];
      for (let line = 2; line <= ws.rowCount; line += 1) {
        const row = ws.getRow(line);
        const isbn = normalizeIsbnCell(row.getCell(isbnCol));
        if (!isbn || isbn === 'None') continue;

        let quantity = 1;
        if (qtyCol >= 1) {
          const rawQty = normalizeRowValue(row.getCell(qtyCol).value);
          quantity = Math.max(1, Number.isFinite(Number(rawQty)) ? Math.trunc(Number(rawQty)) : 1);
        }

        let price: number | null = null;
        if (priceCol >= 1) {
          const rawPrice = normalizeRowValue(row.getCell(priceCol).value).replace(/[^\d.-]/g, '');
          const num = Number(rawPrice);
          if (Number.isFinite(num) && num >= 0) price = num;
        }

        const title = titleCol >= 1 ? normalizeRowValue(row.getCell(titleCol).value) || null : null;
        const author = authorCol >= 1 ? normalizeRowValue(row.getCell(authorCol).value) || null : null;
        const publisher = publisherCol >= 1 ? normalizeRowValue(row.getCell(publisherCol).value) || null : null;
        const publishedDate = pubDateCol >= 1 ? normalizeRowValue(row.getCell(pubDateCol).value) || null : null;
        const categories = catCol >= 1 ? normalizeRowValue(row.getCell(catCol).value) || null : null;
        let pageCount: number | null = null;
        if (pageCol >= 1) {
          const rawPage = parseInt(normalizeRowValue(row.getCell(pageCol).value), 10);
          if (Number.isFinite(rawPage) && rawPage > 0) pageCount = rawPage;
        }
        const shelfLocation = shelfCol >= 1 ? normalizeRowValue(row.getCell(shelfCol).value) || null : null;
        const description = descCol >= 1 ? normalizeRowValue(row.getCell(descCol).value) || null : null;
        const coverUrl = coverCol >= 1 ? normalizeRowValue(row.getCell(coverCol).value) || null : null;
        const subtitle = subCol >= 1 ? normalizeRowValue(row.getCell(subCol).value) || null : null;

        rows.push({
          isbn,
          quantity,
          price,
          title,
          author,
          publisher,
          publishedDate,
          categories,
          pageCount,
          shelfLocation,
          description,
          coverUrl,
          subtitle,
          line,
        });
      }
      if (!rows.length) throw new HttpError(400, 'Khong co du lieu hop le');
      resolve(rows);
    } catch (error) {
      reject(error);
    }
  });
}

const ImportFilteredRowSchema = z.object({
  isbn: z.string(),
  quantity: z.coerce.number().int().positive(),
  price: z.coerce.number().min(0).nullable().optional(),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  published_date: z.string().nullable().optional(),
  page_count: z.coerce.number().int().nullable().optional(),
  categories: z.string().nullable().optional(),
  cover_url: z.string().nullable().optional(),
  shelf_location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  average_rating: z.coerce.number().nullable().optional(),
  language: z.string().nullable().optional(),
  isbn10: z.string().nullable().optional(),
  isbn13: z.string().nullable().optional(),
});

// GET /book/:isbn
router.get('/book/:isbn', async (req, res, next) => {
  try {
    const repo = new BorrowRepository();
    let book = await repo.getBookByIsbn(req.params.isbn.trim());
    if (!book) {
      const meta = await fetchGoogleBooks(req.params.isbn);
      if (!meta) throw new HttpError(404, 'Khong tim thay sach');
      book = await repo.createBook(req.params.isbn, meta.title, meta.author, meta.coverUrl, undefined, {
        subtitle: meta.subtitle,
        publisher: meta.publisher,
        publishedDate: meta.publishedDate,
        description: meta.description,
        pageCount: meta.pageCount,
        categories: meta.categories,
        averageRating: meta.averageRating,
        language: meta.language,
        isbn10: meta.isbn10,
        isbn13: meta.isbn13,
      });
    }
    const total = await repo.countCopies(book.id);
    const available = await repo.countCopies(book.id, true);
    res.json(serializeBookWithStats(book, total, available));
  } catch (error) {
    next(error);
  }
});

// GET /books
router.get('/books', async (req, res, next) => {
  try {
    const skip = Number(req.query.skip || 0);
    const limit = Number(req.query.limit || 20);
    const search = req.query.search as string | undefined;
    const repo = new BorrowRepository();
    const { items, total, stats } = await repo.listBooks(skip, limit, search);
    const aggregateStats = await repo.getAggregateStats();
    res.json({ items: items.map((book) => { const stat = stats.get(book.id) || { total: 0, available: 0 }; return serializeBookWithStats(book, stat.total, stat.available); }), total, skip, limit, aggregateStats });
  } catch (error) {
    next(error);
  }
});

// GET /books/search
router.get('/books/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '');
    if (!q) throw new HttpError(400, 'q is required');
    const { items, stats } = await new BorrowRepository().listBooks(0, 20, q);
    res.json(items.map((book) => { const stat = stats.get(book.id) || { total: 0, available: 0 }; return serializeBookWithStats(book, stat.total, stat.available); }));
  } catch (error) {
    next(error);
  }
});

// GET /books/template
router.get('/books/template', async (req, res, next) => {
  try {
    const isFull = req.query.type === 'full' || req.query.type === 'detailed' || req.query.type === 'internal';
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Books Import');

    if (isFull) {
      ws.addRow([
        'ISBN',
        'Tên sách (Title)',
        'Tác giả (Author)',
        'Nhà xuất bản (Publisher)',
        'Năm XB (Published Date)',
        'Số lượng (Quantity)',
        'Đơn giá (Price)',
        'Thể loại (Categories)',
        'Số trang (Page Count)',
        'Vị trí kệ (Shelf Location)',
        'Mô tả (Description)',
      ]);
      ws.addRow([
        '9780544003415',
        'The Lord of the Rings',
        'J.R.R. Tolkien',
        'Houghton Mifflin',
        '1954',
        5,
        250000,
        'Văn học, Giả tưởng',
        1178,
        'Kệ A-01',
        'Bộ ba tiểu thuyết sử thi giả tưởng kinh điển.',
      ]);
      ws.addRow([
        '9780439708180',
        'Harry Potter and the Sorcerer\'s Stone',
        'J.K. Rowling',
        'Scholastic',
        '1998',
        3,
        180000,
        'Thiếu nhi, Phép thuật',
        309,
        'Kệ B-02',
        'Tập đầu tiên trong bộ truyện về cậu bé phù thủy.',
      ]);
      res.setHeader('Content-Disposition', 'attachment; filename=book_import_template_full.xlsx');
    } else {
      // Basic ISBN-only template (Legacy / Quick mode)
      ws.addRow(['ISBN', 'Quantity', 'Price']);
      ws.addRow(['9780544003415', 2, 120000]);
      ws.addRow(['9780439708180', 3, 150000]);
      res.setHeader('Content-Disposition', 'attachment; filename=book_import_template.xlsx');
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

// GET /books/export
router.get('/books/export', async (_req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const MAX_EXPORT = 10000;
    const { items } = await repo.listBooks(0, MAX_EXPORT);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Books');
    ws.addRow(['ISBN', 'Title', 'Author', 'Total Copies', 'Available Copies', 'Shelf Location', 'Price (VND)', 'Created At']);

    const bookIds = items.map(b => b.id);
    const copyCounts = await repo.getCopyCountsByBookIds(bookIds);

    for (const book of items) {
      const counts = copyCounts.get(book.id) || { total: 0, available: 0 };
      ws.addRow([book.isbn, book.title, book.author || '', counts.total, counts.available, book.shelfLocation || '', book.price ?? '', book.createdAt?.toISOString?.() || '']);
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=books_export.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

// GET /books/:book_id/copies
router.get('/books/:book_id/copies', requireDynamicPermission('books', 'read'), async (req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const book = await repo.getBookById(req.params.book_id);
    if (!book) throw new HttpError(404, 'Sách không tồn tại');
    const items = await repo.listCopiesByBook(book.id);
    res.json({ items: items.map(serializeCopy), total: items.length });
  } catch (error) {
    next(error);
  }
});

// POST /copies
router.post('/copies', requireDynamicPermission('books', 'create'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      book_id: z.string().uuid(),
      barcode: z.string().min(1).optional(),
      shelf_location: z.string().nullable().optional(),
      condition: z.string().optional(),
      status: z.string().optional(),
      imported_at: z.string().nullable().optional(),
    }).parse(req.body);

    const condition = normalizeCondition(body.condition);
    const status = normalizeCopyStatus(body.status);

    const repo = new BorrowRepository();
    const book = await repo.getBookById(body.book_id);
    if (!book) throw new HttpError(404, 'Sách không tồn tại');

    let barcode = body.barcode?.trim();
    if (!barcode) {
      const offset = await repo.getMaxBarcodeNumberForBook(book);
      barcode = `LIB-${book.isbn}-${String(offset + 1).padStart(3, '0')}`;
    }

    let copy;
    try {
      copy = await repo.createCopy(book.id, barcode, body.shelf_location ?? null, {
        condition,
        status,
        importedAt: body.imported_at ? new Date(body.imported_at) : undefined,
      });
    } catch (error: any) {
      if (error?.code === '23505') throw new HttpError(400, `Mã vạch "${barcode}" đã tồn tại`);
      throw error;
    }

    res.status(201).json({ copy: serializeCopy(copy) });
  } catch (error) {
    next(error);
  }
});

// PATCH /copies/:id
router.patch('/copies/:id', requireDynamicPermission('books', 'update'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      condition: z.string().optional(),
      status: z.string().optional(),
      shelf_location: z.string().nullable().optional(),
      barcode: z.string().min(1).optional(),
      note: z.string().optional(),
    }).parse(req.body);

    const condition = body.condition !== undefined ? normalizeCondition(body.condition) : undefined;
    const status = body.status !== undefined ? normalizeCopyStatus(body.status) : undefined;

    const repo = new BorrowRepository();
    const copy = await repo.getCopyById(req.params.id);
    if (!copy) throw new HttpError(404, 'Bản sao không tồn tại');

    const fields: Record<string, any> = {};
    if (condition !== undefined) fields.condition = condition;
    if (status !== undefined) fields.status = status;
    if (body.shelf_location !== undefined) fields.shelfLocation = body.shelf_location;
    if (body.barcode !== undefined) fields.barcode = body.barcode;

    const conditionChanged = condition !== undefined && condition !== copy.condition;

    // Written before the update so previous_condition still reflects the stored value.
    if (conditionChanged) {
      const previous = copy.condition || 'good';
      await repo.insertConditionHistory(
        copy.id,
        condition!,
        req.user?.id || null,
        body.note || `${previous} → ${condition}`,
      );
    }

    const updated = await repo.updateCopy(copy.id, fields);
    if (!updated) throw new HttpError(500, 'Cập nhật bản sao thất bại');

    res.json({ copy: serializeCopy(updated) });
  } catch (error) {
    next(error);
  }
});

// DELETE /copies/:id
router.delete('/copies/:id', requireDynamicPermission('books', 'delete'), async (req, res, next) => {
  try {
    const repo = new BorrowRepository();
    await repo.disposeCopy(req.params.id);
    res.json({ success: true, deleted: 1 });
  } catch (error) {
    next(error);
  }
});

// POST /copies/bulk-dispose — permanently remove lost/damaged copies
router.post('/copies/bulk-dispose', requireDynamicPermission('books', 'delete'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      copy_ids: z.array(z.string().uuid()).min(1).max(200),
    }).parse(req.body);
    const repo = new BorrowRepository();
    const result = await repo.disposeCopies(body.copy_ids);
    res.json({ success: result.skipped.length === 0, deleted: result.deleted.length, deleted_ids: result.deleted, skipped: result.skipped });
  } catch (error) {
    next(error);
  }
});

// GET /books/:book_id
router.get('/books/:book_id', async (req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const book = await repo.getBookById(req.params.book_id);
    if (!book) throw new HttpError(404, 'Sách không tồn tại');
    const total = await repo.countCopies(book.id);
    const available = await repo.countCopies(book.id, true);
    res.json(serializeBookWithStats(book, total, available));
  } catch (error) {
    next(error);
  }
});

// PUT /books/:book_id
router.put('/books/:book_id', requireDynamicPermission('books', 'update'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      title: z.string().min(1).optional(),
      subtitle: z.string().nullable().optional(),
      author: z.string().nullable().optional(),
      publisher: z.string().nullable().optional(),
      published_date: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      page_count: z.coerce.number().int().nullable().optional(),
      categories: z.string().nullable().optional(),
      average_rating: z.coerce.number().min(0).max(5).nullable().optional(),
      language: z.string().nullable().optional(),
      shelf_location: z.string().nullable().optional(),
      cover_url: z.string().nullable().optional(),
      price: z.coerce.number().min(0).nullable().optional(),
    }).parse(req.body);
    const repo = new BorrowRepository();
    const book = await repo.getBookById(req.params.book_id);
    if (!book) throw new HttpError(404, 'Khong tim thay sach');
    const fields: Record<string, any> = {};
    if (body.title !== undefined) fields.title = body.title;
    if (body.subtitle !== undefined) fields.subtitle = body.subtitle;
    if (body.author !== undefined) fields.author = body.author;
    if (body.publisher !== undefined) fields.publisher = body.publisher;
    if (body.published_date !== undefined) fields.publishedDate = body.published_date;
    if (body.description !== undefined) fields.description = body.description;
    if (body.page_count !== undefined) fields.pageCount = body.page_count;
    if (body.categories !== undefined) fields.categories = body.categories;
    if (body.average_rating !== undefined) fields.averageRating = body.average_rating;
    if (body.language !== undefined) fields.language = body.language;
    if (body.shelf_location !== undefined) fields.shelfLocation = body.shelf_location;
    if (body.cover_url !== undefined) fields.coverUrl = body.cover_url;
    if (body.price !== undefined) fields.price = body.price;
    const updated = await repo.updateBook(book.id, fields);
    if (!updated) throw new HttpError(500, 'Cập nhật sách thất bại');
    const total = await repo.countCopies(book.id);
    const available = await repo.countCopies(book.id, true);
    res.json(serializeBookWithStats(updated, total, available));
  } catch (error) {
    next(error);
  }
});

// PUT /books/:book_id/quantity
router.put('/books/:book_id/quantity', requireDynamicPermission('books', 'update'), async (req, res, next) => {
  try {
    const { quantity } = z.object({ quantity: z.number().int() }).parse(req.body);
    const repo = new BorrowRepository();
    const book = await repo.getBookById(req.params.book_id);
    if (!book) throw new HttpError(404, 'Khong tim thay sach');
    const total = await repo.countCopies(book.id);
    const available = await repo.countCopies(book.id, true);
    const borrowed = total - available;
    if (quantity < 1) throw new HttpError(400, 'So luong phai lon hon 0');
    if (quantity < borrowed) throw new HttpError(400, `Chi co the giam xuong toi thieu ${borrowed} ban (${borrowed} ban dang duoc muon)`);
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
    res.json(serializeBookWithStats(book, nextTotal, nextAvailable));
  } catch (error) {
    next(error);
  }
});

// POST /books/delete
router.post('/books/delete', requireDynamicPermission('books', 'delete'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ book_ids: z.array(z.string().uuid()) }).parse(req.body);
    if (body.book_ids.length > 50) throw new HttpError(400, 'Toi da 50 sach mot lan');
    const repo = new BorrowRepository();
    const result = await repo.bulkDeleteBooks(body.book_ids);
    res.json({ ...result, success: result.deleted > 0 && result.errors.length === 0 });
  } catch (error) {
    next(error);
  }
});

// POST /books/bulk-price
router.post('/books/bulk-price', requireDynamicPermission('books', 'update'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      book_ids: z.array(z.string().uuid()).min(1).max(200),
      price: z.coerce.number().min(0),
    }).parse(req.body);
    const repo = new BorrowRepository();
    const result = await repo.bulkUpdateBookPrices(body.book_ids, body.price);
    res.json({ success: true, updated: result.updated });
  } catch (error) {
    next(error);
  }
});

// GET /barcodes
router.get('/barcodes', async (req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const qb = repo.copies.createQueryBuilder('copy').orderBy('copy.createdAt', 'DESC').limit(200);
    if (req.query.book_id) qb.andWhere('copy.bookId = :bookId', { bookId: req.query.book_id });
    if (String(req.query.available_only || 'false') === 'true') qb.andWhere('copy.isAvailable = true');
    const copies = await qb.getMany();
    res.json(copies.map(serializeCopy));
  } catch (error) {
    next(error);
  }
});

// POST /books/import/preview
router.post('/books/import/preview', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, 'Chi ho tro file Excel (.xlsx, .xls)');
    const rows = (await parseExcelRows(req.file.buffer)).slice(0, 100);
    const repo = new BorrowRepository();
    const existing = await repo.getBooksByIsbns(rows.map((row) => row.isbn));
    const offsets = await repo.getBarcodeOffsetsByBooks([...existing.keys()]);

    const mode = (req.body?.mode || req.query?.mode || 'auto') as string;
    const isInternalOnly = mode === 'internal' || String(req.body?.skip_google_books || '') === 'true';

    // If mode is 'internal', skip Google Books completely.
    // If mode is 'isbn' (legacy), fetch Google Books for all new ISBNs.
    // If mode is 'auto', fetch Google Books only when title is missing in Excel.
    const booksNeedingMeta = isInternalOnly
      ? []
      : mode === 'isbn'
        ? [...new Set(rows.filter((r) => !existing.get(r.isbn)).map((r) => r.isbn))]
        : [...new Set(rows.filter((r) => !existing.get(r.isbn) && !r.title).map((r) => r.isbn))];

    const metaMap = new Map<string, any>();
    if (booksNeedingMeta.length > 0) {
      await Promise.all(
        booksNeedingMeta.map(async (isbn) => {
          try {
            const meta = await fetchGoogleBooks(isbn);
            if (meta) metaMap.set(isbn, meta);
          } catch {
            // ignore error to prevent blocking preview
          }
        })
      );
    }

    const preview = [];
    for (const row of rows) {
      const book = existing.get(row.isbn);
      const meta = book || row.title ? null : metaMap.get(row.isbn) || null;
      const offset = offsets.get(row.isbn) || 0;
      const finalTitle = row.title || book?.title || meta?.title || `ISBN: ${row.isbn}`;
      const finalAuthor = row.author || book?.author || meta?.author || null;
      const finalPublisher = row.publisher || book?.publisher || meta?.publisher || null;
      const finalPubDate = row.publishedDate || book?.publishedDate || meta?.publishedDate || null;
      const finalCategories = row.categories || book?.categories || meta?.categories || null;
      const finalPageCount = row.pageCount ?? book?.pageCount ?? meta?.pageCount ?? null;
      const finalCoverUrl = row.coverUrl || book?.coverUrl || meta?.coverUrl || null;
      const finalDesc = row.description || book?.description || meta?.description || null;
      const hasInfo = Boolean(book || row.title || meta);

      preview.push({
        isbn: row.isbn,
        quantity: row.quantity,
        price: row.price ?? (book?.price ? Number(book.price) : null),
        title: finalTitle,
        subtitle: row.subtitle || book?.subtitle || meta?.subtitle || null,
        author: finalAuthor,
        publisher: finalPublisher,
        published_date: finalPubDate,
        page_count: finalPageCount,
        categories: finalCategories,
        cover_url: finalCoverUrl,
        shelf_location: row.shelfLocation || book?.shelfLocation || null,
        description: finalDesc,
        average_rating: book?.averageRating ?? meta?.averageRating ?? null,
        language: book?.language || meta?.language || null,
        isbn10: book?.isbn10 || meta?.isbn10 || null,
        isbn13: book?.isbn13 || meta?.isbn13 || null,
        barcodes: Array.from({ length: row.quantity }, (_, i) => `LIB-${row.isbn}-${String(offset + i + 1).padStart(3, '0')}`),
        status: book ? 'exists' : hasInfo ? 'new' : 'warning',
        message: !hasInfo ? 'Khong co thong tin sach trong file va khong tim thay tren Google Books' : null,
      });
    }
    res.json({ rows: preview, total_rows: preview.length, valid_rows: preview.length, invalid_rows: 0 });
  } catch (error) {
    next(error);
  }
});

// POST /books/import
router.post('/books/import', requireDynamicPermission('books', 'create'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, 'Chi ho tro file Excel (.xlsx, .xls)');
    const rows = await parseExcelRows(req.file.buffer);
    const repo = new BorrowRepository();
    const existing = await repo.getBooksByIsbns(rows.map((row) => row.isbn));
    const offsets = await repo.getBarcodeOffsetsByBooks([...existing.keys()]);

    const mode = (req.body?.mode || req.query?.mode || 'auto') as string;
    const isInternalOnly = mode === 'internal' || String(req.body?.skip_google_books || '') === 'true';

    // Only fetch Google Books for books that need it based on mode
    const booksNeedingMeta = isInternalOnly
      ? []
      : mode === 'isbn'
        ? [...new Set(rows.filter((r) => !existing.get(r.isbn)).map((r) => r.isbn))]
        : [...new Set(rows.filter((r) => !existing.get(r.isbn) && !r.title).map((r) => r.isbn))];

    const metaMap = new Map<string, any>();
    if (booksNeedingMeta.length > 0) {
      await Promise.all(
        booksNeedingMeta.map(async (isbn) => {
          try {
            const meta = await fetchGoogleBooks(isbn);
            if (meta) metaMap.set(isbn, meta);
          } catch {
            // ignore error
          }
        })
      );
    }

    const results = [];
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    for (const row of rows) {
      try {
        let book = existing.get(row.isbn);
        let created = false;
        let noMeta = false;
        if (!book) {
          const meta = metaMap.get(row.isbn) || null;
          noMeta = !row.title && !meta;
          const finalTitle = row.title || meta?.title || `ISBN: ${row.isbn}`;
          const finalAuthor = row.author || meta?.author || undefined;
          const finalCoverUrl = row.coverUrl || meta?.coverUrl || undefined;
          const extra = (meta || row.price != null || row.publisher || row.publishedDate || row.categories || row.pageCount || row.description || row.subtitle) ? {
            subtitle: row.subtitle || meta?.subtitle || null,
            publisher: row.publisher || meta?.publisher || null,
            publishedDate: row.publishedDate || meta?.publishedDate || null,
            description: row.description || meta?.description || null,
            pageCount: row.pageCount ?? meta?.pageCount ?? null,
            categories: row.categories || meta?.categories || null,
            averageRating: meta?.averageRating ?? null,
            language: meta?.language ?? null,
            isbn10: meta?.isbn10 ?? null,
            isbn13: meta?.isbn13 ?? null,
            price: row.price ?? null,
          } : undefined;
          const upserted = await repo.upsertBook(row.isbn, finalTitle, finalAuthor, finalCoverUrl, extra);
          book = upserted.book;
          created = upserted.created;
          existing.set(row.isbn, book);
          offsets.set(row.isbn, 0);
        } else if (row.price !== null && row.price !== undefined) {
          await repo.updateBook(book.id, { price: row.price });
          book.price = row.price;
        }
        const offset = offsets.get(row.isbn) || 0;
        const barcodes = Array.from({ length: row.quantity }, (_, i) => `LIB-${row.isbn}-${String(offset + i + 1).padStart(3, '0')}`);
        offsets.set(row.isbn, offset + row.quantity);
        const shelf = row.shelfLocation || book.shelfLocation;
        const copies = await repo.createCopiesBatchWithSkip(book.id, barcodes, shelf);
        const status = created ? (noMeta ? 'warning' : 'imported') : copies.length ? 'updated' : 'skipped';
        if (status === 'skipped') skipped += 1; else imported += 1;
        results.push({ isbn: row.isbn, title: book.title, quantity: row.quantity, barcodes, status, message: `Them ${copies.length} ban sao${noMeta ? ' (khong co metadata)' : ''}` });
      } catch (error) {
        errors += 1;
        results.push({ isbn: row.isbn, title: '', quantity: row.quantity, barcodes: [], status: 'error', message: error instanceof Error ? error.message : 'Loi import' });
      }
    }
    res.json({ success: errors === 0, total_rows: rows.length, imported, skipped, errors, results });
  } catch (error) {
    next(error);
  }
});

// POST /books/import/filtered
router.post('/books/import/filtered', requireDynamicPermission('books', 'create'), async (req: AuthRequest, res, next) => {
  try {
    const { rows } = z.object({ rows: z.array(ImportFilteredRowSchema) }).parse(req.body);
    if (!rows.length) throw new HttpError(400, 'Khong co du lieu de import');
    const repo = new BorrowRepository();
    const isbns = rows.map((r) => r.isbn);
    const existingRaw = await repo.getBooksByIsbns(isbns);

    const existing = new Map<string, Book>();
    for (const [isbn, book] of existingRaw) {
      existing.set(isbn.replace(/[-\s]/g, ''), book);
    }

    const offsetsRaw = await repo.getBarcodeOffsetsByBooks([...existingRaw.keys()]);
    const offsets = new Map<string, number>();
    for (const [isbn, offset] of offsetsRaw) {
      offsets.set(isbn.replace(/[-\s]/g, ''), offset);
    }

    type AggregatedRow = typeof rows[0] & { totalQuantity: number };
    const aggregated = new Map<string, AggregatedRow>();
    for (const row of rows) {
      const key = row.isbn.replace(/[-\s]/g, '');
      const existingAgg = aggregated.get(key);
      if (existingAgg) {
        existingAgg.totalQuantity += row.quantity;
      } else {
        aggregated.set(key, { ...row, totalQuantity: row.quantity });
      }
    }

    const results = [];
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    for (const [isbnKey, row] of aggregated) {
      try {
        let book = existing.get(isbnKey);
        let created = false;
        if (!book) {
          const title = row.title || `ISBN: ${isbnKey}`;
          const author = row.author || null;
          const coverUrl = row.cover_url || null;
          const upserted = await repo.upsertBook(row.isbn, title, author, coverUrl, {
            subtitle: row.subtitle ?? null,
            publisher: row.publisher ?? null,
            publishedDate: row.published_date ?? null,
            description: row.description ?? null,
            pageCount: row.page_count ?? null,
            categories: row.categories ?? null,
            averageRating: row.average_rating ?? null,
            language: row.language ?? null,
            isbn10: row.isbn10 ?? null,
            isbn13: row.isbn13 ?? null,
            price: row.price ?? null,
          });
          book = upserted.book;
          created = upserted.created;
          existing.set(isbnKey, book);
          offsets.set(isbnKey, 0);
        } else if (row.price !== null && row.price !== undefined) {
          await repo.updateBook(book.id, { price: row.price });
          book.price = row.price;
        }
        const offset = offsets.get(isbnKey) || 0;
        const barcodes = Array.from({ length: row.totalQuantity }, (_, i) => `LIB-${isbnKey}-${String(offset + i + 1).padStart(3, '0')}`);
        offsets.set(isbnKey, offset + row.totalQuantity);
        const copies = await repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
        const status = created ? 'imported' : copies.length ? 'updated' : 'skipped';
        if (status === 'skipped') skipped += 1; else imported += 1;
        results.push({ isbn: row.isbn, title: book.title, quantity: row.totalQuantity, barcodes, status, message: `Them ${copies.length} ban sao` });
      } catch (error) {
        errors += 1;
        results.push({ isbn: row.isbn, title: '', quantity: row.totalQuantity, barcodes: [], status: 'error', message: error instanceof Error ? error.message : 'Loi import' });
      }
    }
    res.json({ success: errors === 0, total_rows: rows.length, imported, skipped, errors, results });
  } catch (error) {
    next(error);
  }
});

// POST /isbn-import/batch
router.post('/isbn-import/batch', requireDynamicPermission('books', 'create'), async (req: AuthRequest, res, next) => {
  try {
    const { items } = z.object({
      items: z.array(z.object({ isbn: z.string().min(1), quantity: z.number().int().min(1) })).min(1).max(50),
    }).parse(req.body);

    const repo = new BorrowRepository();
    const isbns = items.map((item) => item.isbn);
    const existing = await repo.getBooksByIsbns(isbns);
    const offsets = await repo.getBarcodeOffsetsByBooks([...existing.keys()]);
    const results = [];
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const item of items) {
      try {
        let book = existing.get(item.isbn);
        let created = false;
        let noMeta = false;
        if (!book) {
          const meta = await fetchGoogleBooks(item.isbn);
          noMeta = !meta;
          const upserted = await repo.upsertBook(item.isbn, meta?.title || `ISBN: ${item.isbn}`, meta?.author, meta?.coverUrl, meta ? {
            subtitle: meta.subtitle ?? null,
            publisher: meta.publisher ?? null,
            publishedDate: meta.publishedDate ?? null,
            description: meta.description ?? null,
            pageCount: meta.pageCount ?? null,
            categories: meta.categories ?? null,
            averageRating: meta.averageRating ?? null,
            language: meta.language ?? null,
            isbn10: meta.isbn10 ?? null,
            isbn13: meta.isbn13 ?? null,
          } : undefined);
          book = upserted.book;
          created = upserted.created;
          existing.set(item.isbn, book);
          offsets.set(item.isbn, 0);
        }
        const offset = offsets.get(item.isbn) || 0;
        const barcodes = Array.from({ length: item.quantity }, (_, i) => `LIB-${item.isbn}-${String(offset + i + 1).padStart(3, '0')}`);
        offsets.set(item.isbn, offset + item.quantity);
        const copies = await repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
        const status = created ? (noMeta ? 'warning' : 'imported') : copies.length ? 'updated' : 'skipped';
        if (status === 'skipped') skipped += 1; else imported += 1;
        results.push({ isbn: item.isbn, title: book.title, quantity: item.quantity, barcodes, status, message: `Them ${copies.length} ban sao${noMeta ? ' (khong co metadata tu OpenLibrary)' : ''}` });
      } catch (error) {
        errors += 1;
        results.push({ isbn: item.isbn, title: '', quantity: item.quantity, barcodes: [], status: 'error', message: error instanceof Error ? error.message : 'Loi import' });
      }
    }
    res.json({ success: errors === 0, total_rows: items.length, imported, skipped, errors, results });
  } catch (error) {
    next(error);
  }
});

export default router;
