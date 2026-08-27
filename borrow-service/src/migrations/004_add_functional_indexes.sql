-- Migration: Add functional indexes for normalized ISBN/barcode lookups
-- These allow PostgreSQL to use indexes on REPLACE() expressions instead of full table scans.

-- Functional index for normalized ISBN lookup (REPLACE strips dashes and spaces)
-- Used by: getBookByIsbn(), getBookByNormalizedIsbn(), getBooksByIsbns()
CREATE INDEX IF NOT EXISTS idx_books_isbn_normalized
  ON books (REPLACE(REPLACE(isbn, '-', ''), ' ', ''));

-- Functional index for normalized barcode lookup
-- Used by: getCopyByBarcode()
CREATE INDEX IF NOT EXISTS idx_book_copies_barcode_normalized
  ON book_copies (REPLACE(REPLACE(barcode, '-', ''), ' ', ''));

-- Composite index for the hottest query: getActiveBorrow(patronId, bookId)
-- Covers: WHERE patron_id = ? AND book_id = ? AND status = ? AND return_at IS NULL
CREATE INDEX IF NOT EXISTS idx_borrow_records_patron_book_status
  ON borrow_records (patron_id, book_id, status)
  WHERE return_at IS NULL;  -- partial index: only active borrows
