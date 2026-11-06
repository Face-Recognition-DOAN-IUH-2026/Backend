import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1770800000000-AddPgTrgmSearchIndexes
 *
 * Optimize fuzzy (ILIKE '%term%') lookups used by Quick Search on book copies.
 * - Enables pg_trgm extension (PostgreSQL trigram matching).
 * - Adds GIN indexes with gin_trgm_ops on book_copies.barcode, books.title,
 *   books.isbn, books.author so substring searches stay under ~50ms at scale.
 */
export class AddPgTrgmSearchIndexes1770800000000 implements MigrationInterface {
  name = 'AddPgTrgmSearchIndexes1770800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_book_copies_barcode_trgm
      ON book_copies USING gin (barcode gin_trgm_ops);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_books_title_trgm
      ON books USING gin (title gin_trgm_ops);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_books_isbn_trgm
      ON books USING gin (isbn gin_trgm_ops);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_books_author_trgm
      ON books USING gin (author gin_trgm_ops);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_books_author_trgm;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_books_isbn_trgm;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_books_title_trgm;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_book_copies_barcode_trgm;`);
    // pg_trgm extension kept (may be shared); only indexes are reverted.
  }
}
