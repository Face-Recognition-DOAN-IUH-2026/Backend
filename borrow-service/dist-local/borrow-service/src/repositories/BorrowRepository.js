"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BorrowRepository = void 0;
const typeorm_1 = require("typeorm");
const data_source_1 = require("../data-source");
const Book_1 = require("../entities/Book");
const BookCopy_1 = require("../entities/BookCopy");
const BorrowRecord_1 = require("../entities/BorrowRecord");
const BorrowSlip_1 = require("../entities/BorrowSlip");
const config_1 = require("../config");
const fineCalculator_1 = require("../utils/fineCalculator");
class BorrowRepository {
    constructor() {
        this.books = data_source_1.AppDataSource.getRepository(Book_1.Book);
        this.copies = data_source_1.AppDataSource.getRepository(BookCopy_1.BookCopy);
        this.records = data_source_1.AppDataSource.getRepository(BorrowRecord_1.BorrowRecord);
        this.slips = data_source_1.AppDataSource.getRepository(BorrowSlip_1.BorrowSlip);
    }
    normalizeCode(code) {
        return code.replace(/[\s-]+/g, '').trim();
    }
    getBookByIsbn(isbn) {
        const cleaned = this.normalizeCode(isbn);
        return this.books.createQueryBuilder('book')
            .leftJoinAndSelect('book.copies', 'copy')
            .where("REPLACE(REPLACE(book.isbn, '-', ''), ' ', '') = :isbn", { isbn: cleaned })
            .getOne();
    }
    getBookByNormalizedIsbn(isbn) {
        return this.books.createQueryBuilder('book')
            .leftJoinAndSelect('book.copies', 'copy')
            .where("REPLACE(REPLACE(book.isbn, '-', ''), ' ', '') = :isbn", { isbn })
            .getOne();
    }
    getBookById(id) {
        return this.books.findOne({ where: { id }, relations: { copies: true } });
    }
    getCopyByBarcode(barcode) {
        const cleaned = this.normalizeCode(barcode);
        return this.copies.createQueryBuilder('copy')
            .leftJoinAndSelect('copy.book', 'book')
            .where("REPLACE(REPLACE(copy.barcode, '-', ''), ' ', '') = :barcode", { barcode: cleaned })
            .getOne();
    }
    getCopyById(id) {
        return this.copies.findOne({ where: { id }, relations: { book: true } });
    }
    async getAvailableCopy(bookId) {
        return this.copies.findOne({ where: { bookId, isAvailable: true }, order: { createdAt: 'ASC' } });
    }
    async listBooks(skip = 0, limit = 20, search) {
        const qb = this.books.createQueryBuilder('book');
        if (search) {
            qb.where(new typeorm_1.Brackets((where) => {
                where.where('book.isbn ILIKE :q', { q: `%${search}%` })
                    .orWhere('book.title ILIKE :q', { q: `%${search}%` })
                    .orWhere('book.author ILIKE :q', { q: `%${search}%` });
            }));
        }
        const [items, total] = await qb.orderBy('book.createdAt', 'DESC').skip(skip).take(limit).getManyAndCount();
        const stats = await this.getStatsForBooks(items.map((book) => book.id));
        return { items, total, stats };
    }
    async getStatsForBooks(bookIds) {
        if (!bookIds.length)
            return new Map();
        const rows = await this.copies.createQueryBuilder('copy')
            .select('copy.bookId', 'book_id')
            .addSelect('COUNT(copy.id)', 'total')
            .addSelect(`SUM(CASE WHEN copy.isAvailable = true THEN 1 ELSE 0 END)`, 'available')
            .where('copy.bookId IN (:...bookIds)', { bookIds })
            .groupBy('copy.bookId')
            .getRawMany();
        const map = new Map();
        rows.forEach((row) => map.set(row.book_id, { total: Number(row.total), available: Number(row.available || 0) }));
        return map;
    }
    async createBook(isbn, title, author, coverUrl, shelfLocation, extra) {
        const book = this.books.create({
            isbn: this.normalizeCode(isbn),
            title,
            author: author || null,
            coverUrl: coverUrl || null,
            shelfLocation: shelfLocation || null,
            subtitle: extra?.subtitle || null,
            publisher: extra?.publisher || null,
            publishedDate: extra?.publishedDate || null,
            description: extra?.description || null,
            pageCount: extra?.pageCount || null,
            categories: extra?.categories || null,
            averageRating: extra?.averageRating || null,
            language: extra?.language || null,
            isbn10: extra?.isbn10 || null,
            isbn13: extra?.isbn13 || null,
        });
        return this.books.save(book);
    }
    async upsertBook(isbn, title, author, coverUrl, extra) {
        const existing = await this.getBookByIsbn(isbn);
        if (existing) {
            existing.title = title || existing.title;
            if (author !== undefined)
                existing.author = author;
            if (coverUrl !== undefined)
                existing.coverUrl = coverUrl;
            if (extra) {
                if (extra.subtitle !== undefined)
                    existing.subtitle = extra.subtitle;
                if (extra.publisher !== undefined)
                    existing.publisher = extra.publisher;
                if (extra.publishedDate !== undefined)
                    existing.publishedDate = extra.publishedDate;
                if (extra.description !== undefined)
                    existing.description = extra.description;
                if (extra.pageCount !== undefined)
                    existing.pageCount = extra.pageCount;
                if (extra.categories !== undefined)
                    existing.categories = extra.categories;
                if (extra.averageRating !== undefined)
                    existing.averageRating = extra.averageRating;
                if (extra.language !== undefined)
                    existing.language = extra.language;
                if (extra.isbn10 !== undefined)
                    existing.isbn10 = extra.isbn10;
                if (extra.isbn13 !== undefined)
                    existing.isbn13 = extra.isbn13;
            }
            return { book: await this.books.save(existing), created: false };
        }
        return { book: await this.createBook(this.normalizeCode(isbn), title, author, coverUrl, undefined, extra), created: true };
    }
    async createCopy(bookId, barcode, shelfLocation) {
        const copy = this.copies.create({ bookId, barcode: this.normalizeCode(barcode), isAvailable: true, shelfLocation: shelfLocation || null });
        return this.copies.save(copy);
    }
    async createCopiesBatchWithSkip(bookId, barcodes, shelfLocation) {
        const normalized = barcodes.map(b => this.normalizeCode(b));
        // Batch check which barcodes already exist
        const existingCopies = await this.copies.find({
            where: { barcode: (0, typeorm_1.In)(normalized) }
        });
        const existingBarcodes = new Set(existingCopies.map(c => c.barcode));
        // Filter out existing barcodes
        const newBarcodes = normalized.filter(b => !existingBarcodes.has(b));
        if (newBarcodes.length === 0)
            return [];
        // Batch insert new copies
        const newCopies = this.copies.create(newBarcodes.map(barcode => ({
            bookId,
            barcode,
            isAvailable: true,
            shelfLocation: shelfLocation || null,
        })));
        return this.copies.save(newCopies);
    }
    async setCopyAvailable(copy, isAvailable) {
        copy.isAvailable = isAvailable;
        copy.updatedAt = new Date();
        await this.copies.save(copy);
        const availableCount = await this.copies.count({ where: { bookId: copy.bookId, isAvailable: true } });
        const book = await this.books.findOne({ where: { id: copy.bookId } });
        if (book) {
            book.isAvailable = availableCount > 0;
            await this.books.save(book);
        }
    }
    async getActiveBorrow(patronId, bookId) {
        return this.records.findOne({ where: { patronId, bookId, status: 'borrowed', returnAt: (0, typeorm_1.IsNull)() }, relations: { book: true, copy: true } });
    }
    async getActiveBorrowsByPatronAndBook(patronId, bookId) {
        return this.records.find({ where: { patronId, bookId, status: 'borrowed', returnAt: (0, typeorm_1.IsNull)() }, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' } });
    }
    async getActiveBorrowByCopy(copyId) {
        return this.records.findOne({ where: { copyId, status: 'borrowed', returnAt: (0, typeorm_1.IsNull)() }, relations: { book: true, copy: true } });
    }
    getBorrowRecordById(id) {
        return this.records.findOne({ where: { id }, relations: { book: true, copy: true } });
    }
    getAllActiveBorrows() {
        return this.records.find({ where: { status: 'borrowed', returnAt: (0, typeorm_1.IsNull)() }, relations: { book: true, copy: true }, order: { dueAt: 'ASC', borrowAt: 'DESC' } });
    }
    countActiveBorrows(patronId) {
        return this.records.count({ where: { patronId, status: 'borrowed', returnAt: (0, typeorm_1.IsNull)() } });
    }
    getOverdueBorrows(patronId) {
        return this.records.createQueryBuilder('record')
            .where('record.patronId = :patronId', { patronId })
            .andWhere('record.status = :status', { status: 'borrowed' })
            .andWhere('record.returnAt IS NULL')
            .andWhere('record.dueAt < :now', { now: new Date() })
            .getMany();
    }
    async getStats() {
        const total = await this.records.count();
        const active = await this.records.count({ where: { status: 'borrowed', returnAt: (0, typeorm_1.IsNull)() } });
        const overdue = await this.records.createQueryBuilder('record')
            .where('record.status = :status', { status: 'borrowed' })
            .andWhere('record.returnAt IS NULL')
            .andWhere('record.dueAt < :now', { now: new Date() })
            .getCount();
        return { total, active, overdue };
    }
    getBorrowsByPatron(patronId, status) {
        const where = { patronId };
        if (status)
            where.status = status;
        return this.records.find({ where, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' } });
    }
    getActiveBorrowsByPatron(patronId) {
        return this.records.find({ where: { patronId, status: 'borrowed', returnAt: (0, typeorm_1.IsNull)() }, relations: { book: true, copy: true }, order: { dueAt: 'ASC', borrowAt: 'DESC' } });
    }
    async createBorrowRecord(patronId, bookId, copyId, shelfLocation) {
        const dueAt = new Date(Date.now() + config_1.config.maxBorrowDays * 24 * 60 * 60 * 1000);
        const record = this.records.create({ patronId, bookId, copyId: copyId || null, borrowAt: new Date(), dueAt, shelfLocation: shelfLocation || null, status: 'borrowed' });
        return this.records.save(record);
    }
    async returnBook(record, returnedByUserId, returnedByEmail, returnMethod, note) {
        record.returnAt = new Date();
        record.status = 'returned';
        record.returnedByUserId = returnedByUserId || null;
        record.returnedByEmail = returnedByEmail || null;
        record.returnMethod = returnMethod || null;
        record.note = note || null;
        record.updatedAt = new Date();
        const now = new Date();
        if (record.dueAt && now > new Date(record.dueAt)) {
            const overdueMs = now.getTime() - new Date(record.dueAt).getTime();
            const overdueDays = Math.ceil(overdueMs / (1000 * 60 * 60 * 24));
            record.fineAmount = (0, fineCalculator_1.calculateOverdueFine)(overdueDays);
        }
        const saved = await this.records.save(record);
        if (record.slipId) {
            await this.closeSlipIfComplete(record.slipId);
        }
        return saved;
    }
    async getBooksByIsbns(isbns) {
        if (!isbns.length)
            return new Map();
        const cleaned = isbns.map((isbn) => this.normalizeCode(isbn));
        const books = await this.books.createQueryBuilder('book')
            .where("REPLACE(REPLACE(book.isbn, '-', ''), ' ', '') IN (:...isbns)", { isbns: cleaned })
            .getMany();
        return new Map(books.map((book) => [book.isbn, book]));
    }
    async getBarcodeOffsetsByBooks(isbns) {
        if (!isbns.length)
            return new Map();
        const rows = await this.copies.createQueryBuilder('copy')
            .innerJoin(Book_1.Book, 'book', 'book.id = copy.bookId')
            .select('book.isbn', 'isbn')
            .addSelect('MAX(copy.barcode)', 'max_barcode')
            .where('book.isbn IN (:...isbns)', { isbns })
            .andWhere('copy.barcode LIKE :prefix', { prefix: 'LIB%' })
            .groupBy('book.isbn')
            .getRawMany();
        const map = new Map();
        rows.forEach((row) => {
            const barcode = String(row.max_barcode || '');
            const normalized = barcode.replace(/[\s-]+/g, '');
            const match = normalized.match(/(\d{3})$/);
            if (match)
                map.set(row.isbn, Number(match[1]));
        });
        return map;
    }
    async countCopies(bookId, availableOnly = false) {
        const where = { bookId };
        if (availableOnly)
            where.isAvailable = true;
        return this.copies.count({ where });
    }
    async getMaxBarcodeNumberForBook(book) {
        const row = await this.copies.createQueryBuilder('copy')
            .select('MAX(copy.barcode)', 'max_barcode')
            .where('copy.bookId = :bookId', { bookId: book.id })
            .andWhere('copy.barcode LIKE :prefix', { prefix: 'LIB%' })
            .getRawOne();
        const barcode = String(row?.max_barcode || '');
        const normalized = barcode.replace(/[\s-]+/g, '');
        const match = normalized.match(/(\d{3})$/);
        return match ? Number(match[1]) : 0;
    }
    async updateBook(bookId, fields) {
        const book = await this.books.findOne({ where: { id: bookId } });
        if (!book)
            return null;
        Object.assign(book, fields, { updatedAt: new Date() });
        return this.books.save(book);
    }
    async getAvailableCopiesByBarcodeDesc(bookId) {
        return this.copies.find({ where: { bookId, isAvailable: true }, order: { barcode: 'DESC' } });
    }
    deleteCopies(copies) {
        return this.copies.remove(copies);
    }
    async hasActiveBorrows(bookId) {
        const count = await this.records.createQueryBuilder('record')
            .innerJoin('record.copy', 'copy')
            .where('copy.bookId = :bookId', { bookId })
            .andWhere('record.status = :status', { status: 'borrowed' })
            .andWhere('record.returnAt IS NULL')
            .getCount();
        return count > 0;
    }
    async deleteBookAndCopies(bookId) {
        await this.records.createQueryBuilder()
            .delete()
            .from(BorrowRecord_1.BorrowRecord)
            .where('copyId IN (SELECT id FROM book_copies WHERE bookId = :bookId)', { bookId })
            .execute();
        await this.copies.delete({ bookId });
        await this.books.delete(bookId);
    }
    async bulkDeleteBooks(bookIds) {
        const errors = [];
        let deleted = 0;
        for (const bookId of bookIds) {
            const hasActive = await this.hasActiveBorrows(bookId);
            if (hasActive) {
                const book = await this.books.findOne({ where: { id: bookId } });
                errors.push(book ? `${book.title} (${book.isbn}) - đang có bản được mượn` : `ID ${bookId} - đang có bản được mượn`);
                continue;
            }
            await this.deleteBookAndCopies(bookId);
            deleted++;
        }
        return { deleted, errors };
    }
    // === Borrow Slip ===
    async createSlip(patronId, bookIds, copyIds, shelfLocations, createdByUserId, createdByEmail, note) {
        const dueAt = new Date(Date.now() + config_1.config.maxBorrowDays * 24 * 60 * 60 * 1000);
        const slip = this.slips.create({ patronId, dueAt, status: 'active', createdByUserId: createdByUserId || null, createdByEmail: createdByEmail || null, totalItems: bookIds.length, note: note || null });
        await this.slips.save(slip);
        const records = [];
        for (let i = 0; i < bookIds.length; i += 1) {
            const record = this.records.create({
                patronId, bookId: bookIds[i], copyId: copyIds[i] || null, slipId: slip.id,
                borrowAt: new Date(), dueAt, shelfLocation: shelfLocations[i] || null, status: 'borrowed',
            });
            records.push(record);
        }
        await this.records.save(records);
        slip.totalItems = records.length;
        await this.slips.save(slip);
        return { slip, records };
    }
    getActiveSlip(slipId) {
        return this.slips.findOne({ where: { id: slipId, status: 'active' } });
    }
    async closeSlipIfComplete(slipId) {
        const remaining = await this.records.count({ where: { slipId, status: 'borrowed', returnAt: (0, typeorm_1.IsNull)() } });
        if (remaining === 0) {
            await this.slips.update(slipId, { status: 'closed', updatedAt: new Date() });
            return true;
        }
        return false;
    }
    getRecordsBySlipId(slipId) {
        return this.records.find({ where: { slipId }, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' } });
    }
    getSlipsByPatron(patronId) {
        return this.slips.find({ where: { patronId }, order: { createdAt: 'DESC' } });
    }
    async getCopiesByBarcodes(barcodes) {
        const copies = await this.copies.find({
            where: { barcode: (0, typeorm_1.In)(barcodes) },
            relations: { book: true },
        });
        return new Map(copies.map(c => [c.barcode, c]));
    }
    async getCopyCountsByBookIds(bookIds) {
        const result = new Map();
        const counts = await this.copies
            .createQueryBuilder('copy')
            .select('copy.book_id', 'bookId')
            .addSelect('COUNT(*)', 'total')
            .addSelect('SUM(CASE WHEN copy.is_available = true THEN 1 ELSE 0 END)', 'available')
            .where('copy.book_id IN (:...bookIds)', { bookIds })
            .groupBy('copy.book_id')
            .getRawMany();
        for (const count of counts) {
            result.set(count.bookId, {
                total: parseInt(count.total),
                available: parseInt(count.available),
            });
        }
        return result;
    }
}
exports.BorrowRepository = BorrowRepository;
