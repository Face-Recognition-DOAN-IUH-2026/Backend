"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const data_source_1 = require("../data-source");
const BookCopy_1 = require("../entities/BookCopy");
const router = (0, express_1.Router)();
const PER_TIER = 5;
const AUTO_POSITIONS = [
    [-4, 0, -2], [-4, 0, 2], [-4, 0, 6],
    [0, 0, -2], [0, 0, 2], [0, 0, 6],
    [4, 0, -2], [4, 0, 2], [4, 0, 6],
    [-2, 0, -4], [-2, 0, 4],
    [2, 0, -4], [2, 0, 4],
    [-4, 0, -6], [0, 0, -6], [4, 0, -6],
];
function createShelf(books, index, position) {
    const numTiers = Math.ceil(books.length / PER_TIER);
    return {
        id: `shelf-${index}`,
        code: `Kệ ${index}`,
        position,
        numTiers,
        books: books.map((b, i) => ({ ...b, tierIndex: Math.floor(i / PER_TIER) })),
    };
}
/**
 * @swagger
 * /library/shelves:
 *   get:
 *     summary: Get 3D library shelf layout
 *     tags: [Library]
 *     responses:
 *       200:
 *         description: Shelf layout for 3D viewer
 */
router.get('/shelves', async (_req, res, next) => {
    try {
        const copyRepo = data_source_1.AppDataSource.getRepository(BookCopy_1.BookCopy);
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
        const shelves = [];
        let batch = [];
        let shelfIndex = 0;
        let gridIndex = 0;
        for (const copy of copies) {
            const item = {
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
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
