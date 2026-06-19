import { Router } from 'express';
import { AppDataSource } from '../data-source';
import { auth } from '../middlewares/auth';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { In } from 'typeorm';

const router = Router();

router.use(auth);

const KNOWN_POSITIONS: Record<string, [number, number, number]> = {
  'A-12-3': [-4, 0, -2],
  'A-12-2': [-4, 0, 2],
  'A-12-1': [-4, 0, 6],
  'B-05-1': [0, 0, -2],
  'B-05-2': [0, 0, 2],
  'C-01-1': [4, 0, -2],
  'C-01-2': [4, 0, 2],
};

interface BookItem {
  id: string;
  title: string;
  author: string;
  isbn: string;
  status: 'available' | 'borrowed';
  tierIndex: number;
}

interface ShelfItem {
  id: string;
  code: string;
  position: [number, number, number];
  numTiers: number;
  books: BookItem[];
}

router.get('/shelves', async (_req, res, next) => {
  try {
    const bookRepo = AppDataSource.getRepository(Book);
    const copyRepo = AppDataSource.getRepository(BookCopy);

    const copies = await copyRepo.find({
      relations: ['book'],
      select: {
        id: true,
        barcode: true,
        isAvailable: true,
        shelfLocation: true,
        book: {
          id: true,
          title: true,
          author: true,
          isbn: true,
        },
      },
    });

    const shelfMap = new Map<string, BookItem[]>();

    for (const copy of copies) {
      const location = copy.shelfLocation || 'Chưa phân loại';
      if (!shelfMap.has(location)) {
        shelfMap.set(location, []);
      }
      shelfMap.get(location)!.push({
        id: copy.id,
        title: copy.book.title,
        author: copy.book.author || 'Không rõ',
        isbn: copy.book.isbn,
        status: copy.isAvailable ? 'available' : 'borrowed',
        tierIndex: 0,
      });
    }

    const shelves: ShelfItem[] = [];
    let index = 0;
    for (const [code, books] of shelfMap.entries()) {
      const position = KNOWN_POSITIONS[code] || [0, 0, 0];
      const totalBooks = books.length;
      const numTiers = Math.max(3, Math.ceil(totalBooks / 5));
      const booksPerTier = Math.ceil(totalBooks / numTiers);
      const tieredBooks = books.map((book, i) => ({
        ...book,
        tierIndex: Math.min(Math.floor(i / booksPerTier), numTiers - 1),
      }));
      shelves.push({
        id: `shelf-${index + 1}`,
        code,
        position,
        numTiers,
        books: tieredBooks,
      });
      index++;
    }

    res.json({ shelves });
  } catch (err) {
    next(err);
  }
});

export default router;
