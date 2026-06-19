import { Router } from 'express';
import { AppDataSource } from '../data-source';
import { BookCopy } from '../entities/BookCopy';

const router = Router();

const PER_TIER = 5;

const AUTO_POSITIONS: [number, number, number][] = [
  [-4, 0, -2], [-4, 0, 2], [-4, 0, 6],
  [0, 0, -2],  [0, 0, 2],  [0, 0, 6],
  [4, 0, -2],  [4, 0, 2],  [4, 0, 6],
  [-2, 0, -4], [-2, 0, 4],
  [2, 0, -4],  [2, 0, 4],
  [-4, 0, -6], [0, 0, -6], [4, 0, -6],
];

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

function createShelf(books: BookItem[], index: number, position: [number, number, number]): ShelfItem {
  const numTiers = Math.ceil(books.length / PER_TIER);
  return {
    id: `shelf-${index}`,
    code: `Kệ ${index}`,
    position,
    numTiers,
    books: books.map((b, i) => ({ ...b, tierIndex: Math.floor(i / PER_TIER) })),
  };
}

router.get('/shelves', async (_req, res, next) => {
  try {
    const copyRepo = AppDataSource.getRepository(BookCopy);

    const copies = await copyRepo.find({
      relations: ['book'],
      order: { book: { title: 'ASC' } },
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

    const shelves: ShelfItem[] = [];
    let batch: BookItem[] = [];
    let shelfIndex = 0;
    let gridIndex = 0;

    for (const copy of copies) {
      const item: BookItem = {
        id: copy.id,
        title: copy.book.title,
        author: copy.book.author || 'Không rõ',
        isbn: copy.book.isbn,
        status: copy.isAvailable ? 'available' : 'borrowed',
        tierIndex: 0,
      };

      batch.push(item);

      if (batch.length === PER_TIER * 3) {
        shelves.push(createShelf(batch, ++shelfIndex, AUTO_POSITIONS[gridIndex % AUTO_POSITIONS.length]));
        gridIndex++;
        batch = [];
      }
    }

    if (batch.length > 0) {
      shelves.push(createShelf(batch, ++shelfIndex, AUTO_POSITIONS[gridIndex % AUTO_POSITIONS.length]));
    }

    res.json({ shelves });
  } catch (err) {
    next(err);
  }
});

export default router;
