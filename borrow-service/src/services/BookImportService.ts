import ExcelJS from 'exceljs';
import { z } from 'zod';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { HttpError } from '../../../shared/error-handler';
import { fetchGoogleBooks } from '../clients/GoogleBooksClient';
import { Book } from '../entities/Book';

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

function normalizeBookCode(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/\.0+$/, '');
}

async function parseExcelRows(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const ws = workbook.worksheets[0];
  if (!ws || ws.rowCount < 2) throw new HttpError(400, 'File Excel trong hoac khong co du lieu');
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, col) => { headers[col] = normalizeRowValue(cell.value).toUpperCase(); });
  const isbnCol = headers.findIndex((h) => !!h && h.includes('ISBN'));
  const qtyCol = headers.findIndex((h) => !!h && (h.includes('QUANTITY') || h.includes('QTY') || h.includes('SO LUONG') || h.includes('SỐ LƯỢNG')));
  const priceCol = headers.findIndex((h) => !!h && (
    h.includes('PRICE') || h.includes('GIA') || h.includes('GIÁ') || h.includes('DON GIA') || h.includes('ĐƠN GIÁ') || h.includes('COST')
  ));
  if (isbnCol < 1 || qtyCol < 1) throw new HttpError(400, "File phai co cot 'ISBN' va 'Quantity'");
  const rows: Array<{ isbn: string; quantity: number; price: number | null; line: number }> = [];
  for (let line = 2; line <= ws.rowCount; line += 1) {
    const row = ws.getRow(line);
    const isbn = normalizeIsbnCell(row.getCell(isbnCol));
    if (!isbn || isbn === 'None') continue;
    const rawQty = normalizeRowValue(row.getCell(qtyCol).value);
    const quantity = Math.max(1, Number.isFinite(Number(rawQty)) ? Math.trunc(Number(rawQty)) : 1);
    let price: number | null = null;
    if (priceCol >= 1) {
      const rawPrice = normalizeRowValue(row.getCell(priceCol).value).replace(/[^\d.-]/g, '');
      const num = Number(rawPrice);
      if (Number.isFinite(num) && num >= 0) {
        price = num;
      }
    }
    rows.push({ isbn, quantity, price, line });
  }
  if (!rows.length) throw new HttpError(400, 'Khong co du lieu hop le');
  return rows;
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
  description: z.string().nullable().optional(),
  average_rating: z.coerce.number().nullable().optional(),
  language: z.string().nullable().optional(),
  isbn10: z.string().nullable().optional(),
  isbn13: z.string().nullable().optional(),
});

export class BookImportService {
  private repo: BorrowRepository;

  constructor() {
    this.repo = new BorrowRepository();
  }

  async previewImport(fileBuffer: Buffer) {
    const rows = (await parseExcelRows(fileBuffer)).slice(0, 100);
    const existing = await this.repo.getBooksByIsbns(rows.map((row) => row.isbn));
    const offsets = await this.repo.getBarcodeOffsetsByBooks([...existing.keys()]);
    const preview = [];
    for (const row of rows) {
      const book = existing.get(row.isbn);
      const meta = book ? null : await fetchGoogleBooks(row.isbn);
      const offset = offsets.get(row.isbn) || 0;
      preview.push({
        isbn: row.isbn,
        quantity: row.quantity,
        price: row.price ?? (book?.price ? Number(book.price) : null),
        title: book?.title || meta?.title || `ISBN: ${row.isbn}`,
        subtitle: book?.subtitle || meta?.subtitle || null,
        author: book?.author || meta?.author || null,
        publisher: book?.publisher || meta?.publisher || null,
        published_date: book?.publishedDate || meta?.publishedDate || null,
        page_count: book?.pageCount || meta?.pageCount || null,
        categories: book?.categories || meta?.categories || null,
        cover_url: book?.coverUrl || meta?.coverUrl || null,
        description: book?.description || meta?.description || null,
        average_rating: book?.averageRating ?? meta?.averageRating ?? null,
        language: book?.language || meta?.language || null,
        isbn10: book?.isbn10 || meta?.isbn10 || null,
        isbn13: book?.isbn13 || meta?.isbn13 || null,
        barcodes: Array.from({ length: row.quantity }, (_, i) => `LIB-${row.isbn}-${String(offset + i + 1).padStart(3, '0')}`),
        status: book ? 'exists' : meta ? 'new' : 'warning',
        message: !book && !meta ? 'Khong co metadata tu Google Books' : null,
      });
    }
    return { rows: preview, total_rows: preview.length, valid_rows: preview.length, invalid_rows: 0 };
  }

  async importFromExcel(fileBuffer: Buffer) {
    const rows = await parseExcelRows(fileBuffer);
    const existing = await this.repo.getBooksByIsbns(rows.map((row) => row.isbn));
    const offsets = await this.repo.getBarcodeOffsetsByBooks([...existing.keys()]);

    // Pre-fetch metadata for all unknown ISBNs in parallel batches → O(R/10 × HTTP) instead of O(R × HTTP)
    const unknownIsbns = rows.map(r => r.isbn).filter(isbn => !existing.has(isbn));
    const GOOGLE_BATCH = 10;
    const metaMap = new Map<string, Awaited<ReturnType<typeof fetchGoogleBooks>>>();
    for (let i = 0; i < unknownIsbns.length; i += GOOGLE_BATCH) {
      const batch = unknownIsbns.slice(i, i + GOOGLE_BATCH);
      const results = await Promise.all(batch.map(isbn => fetchGoogleBooks(isbn).catch(() => null)));
      batch.forEach((isbn, idx) => metaMap.set(isbn, results[idx]));
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
          const meta = metaMap.get(row.isbn) ?? null;
          noMeta = !meta;
          const upserted = await this.repo.upsertBook(row.isbn, meta?.title || `ISBN: ${row.isbn}`, meta?.author, meta?.coverUrl, {
            subtitle: meta?.subtitle ?? null,
            publisher: meta?.publisher ?? null,
            publishedDate: meta?.publishedDate ?? null,
            description: meta?.description ?? null,
            pageCount: meta?.pageCount ?? null,
            categories: meta?.categories ?? null,
            averageRating: meta?.averageRating ?? null,
            language: meta?.language ?? null,
            isbn10: meta?.isbn10 ?? null,
            isbn13: meta?.isbn13 ?? null,
            price: row.price ?? null,
          });
          book = upserted.book;
          created = upserted.created;
          existing.set(row.isbn, book);
          offsets.set(row.isbn, 0);
        } else if (row.price !== null && row.price !== undefined) {
          await this.repo.updateBook(book.id, { price: row.price });
          book.price = row.price;
        }
        const offset = offsets.get(row.isbn) || 0;
        const barcodes = Array.from({ length: row.quantity }, (_, i) => `LIB-${row.isbn}-${String(offset + i + 1).padStart(3, '0')}`);
        offsets.set(row.isbn, offset + row.quantity);
        const copies = await this.repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
        const status = created ? (noMeta ? 'warning' : 'imported') : copies.length ? 'updated' : 'skipped';
        if (status === 'skipped') skipped += 1; else imported += 1;
        results.push({ isbn: row.isbn, title: book.title, quantity: row.quantity, barcodes, status, message: `Them ${copies.length} ban sao${noMeta ? ' (khong co metadata tu OpenLibrary)' : ''}` });
      } catch (error) {
        errors += 1;
        results.push({ isbn: row.isbn, title: '', quantity: row.quantity, barcodes: [], status: 'error', message: error instanceof Error ? error.message : 'Loi import' });
      }
    }
    return { success: errors === 0, total_rows: rows.length, imported, skipped, errors, results };
  }

  async importFiltered(rows: z.infer<typeof ImportFilteredRowSchema>[]) {
    if (!rows.length) throw new HttpError(400, 'Khong co du lieu de import');
    const isbns = rows.map((r) => r.isbn);
    const existingRaw = await this.repo.getBooksByIsbns(isbns);

    const existing = new Map<string, Book>();
    for (const [isbn, book] of existingRaw) {
      existing.set(isbn.replace(/[-\s]/g, ''), book);
    }

    const offsetsRaw = await this.repo.getBarcodeOffsetsByBooks([...existingRaw.keys()]);
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
          const upserted = await this.repo.upsertBook(row.isbn, title, author, coverUrl, {
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
          await this.repo.updateBook(book.id, { price: row.price });
          book.price = row.price;
        }
        const offset = offsets.get(isbnKey) || 0;
        const barcodes = Array.from({ length: row.totalQuantity }, (_, i) => `LIB-${isbnKey}-${String(offset + i + 1).padStart(3, '0')}`);
        offsets.set(isbnKey, offset + row.totalQuantity);
        const copies = await this.repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
        const status = created ? 'imported' : copies.length ? 'updated' : 'skipped';
        if (status === 'skipped') skipped += 1; else imported += 1;
        results.push({ isbn: row.isbn, title: book.title, quantity: row.totalQuantity, barcodes, status, message: `Them ${copies.length} ban sao` });
      } catch (error) {
        errors += 1;
        results.push({ isbn: row.isbn, title: '', quantity: row.totalQuantity, barcodes: [], status: 'error', message: error instanceof Error ? error.message : 'Loi import' });
      }
    }
    return { success: errors === 0, total_rows: rows.length, imported, skipped, errors, results };
  }

  async importByISBN(items: { isbn: string; quantity: number }[]) {
    if (!items.length) throw new HttpError(400, 'Khong co du lieu de import');
    
    const isbns = items.map((item) => item.isbn);
    const existing = await this.repo.getBooksByIsbns(isbns);
    const offsets = await this.repo.getBarcodeOffsetsByBooks([...existing.keys()]);

    // Pre-fetch metadata for all unknown ISBNs in parallel batches → O(R/10 × HTTP)
    const unknownIsbns = isbns.filter(isbn => !existing.has(isbn));
    const GOOGLE_BATCH = 10;
    const metaMap = new Map<string, Awaited<ReturnType<typeof fetchGoogleBooks>>>();
    for (let i = 0; i < unknownIsbns.length; i += GOOGLE_BATCH) {
      const batch = unknownIsbns.slice(i, i + GOOGLE_BATCH);
      const results = await Promise.all(batch.map(isbn => fetchGoogleBooks(isbn).catch(() => null)));
      batch.forEach((isbn, idx) => metaMap.set(isbn, results[idx]));
    }

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
          const meta = metaMap.get(item.isbn) ?? null;
          noMeta = !meta;
          const upserted = await this.repo.upsertBook(item.isbn, meta?.title || `ISBN: ${item.isbn}`, meta?.author, meta?.coverUrl, meta ? {
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
        const copies = await this.repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
        const status = created ? (noMeta ? 'warning' : 'imported') : copies.length ? 'updated' : 'skipped';
        if (status === 'skipped') skipped += 1; else imported += 1;
        results.push({ isbn: item.isbn, title: book.title, quantity: item.quantity, barcodes, status, message: `Them ${copies.length} ban sao${noMeta ? ' (khong co metadata tu OpenLibrary)' : ''}` });
      } catch (error) {
        errors += 1;
        results.push({ isbn: item.isbn, title: '', quantity: item.quantity, barcodes: [], status: 'error', message: error instanceof Error ? error.message : 'Loi import' });
      }
    }
    return { success: errors === 0, total_rows: items.length, imported, skipped, errors, results };
  }
}