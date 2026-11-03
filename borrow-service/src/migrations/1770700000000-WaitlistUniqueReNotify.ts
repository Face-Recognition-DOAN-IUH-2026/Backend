import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BLF-WL-01 — waitlist uniqueness and re-notification.
 *
 * 1a: `WaitlistRepository.joinWaitlist` does check-then-insert with no unique
 *     constraint, so concurrent subscriptions for the same (book, patron) both
 *     succeed. This migration adds a partial unique index so the DB, not the
 *     application pre-check, is the correctness mechanism.
 * 1b: notified rows are reset back to waiting on the next borrow (see
 *     BorrowRepository.createBorrowRecord), so a patron is re-notified across
 *     borrow/return cycles.
 *
 * The partial index only covers status IN ('waiting','notified'), so a patron
 * may re-subscribe after a 'cancelled' row.
 */
export class WaitlistUniqueReNotify1770700000000 implements MigrationInterface {
  name = 'WaitlistUniqueReNotify1770700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Deduplicate existing rows: keep the earliest created_at per (book_id, patron_id).
    await queryRunner.query(`
      DELETE FROM waitlists w1
      USING waitlists w2
      WHERE w1.book_id = w2.book_id
        AND w1.patron_id = w2.patron_id
        AND w1.created_at > w2.created_at
    `);

    // 2. Partial unique index on active (waiting/notified) subscriptions.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_waitlists_book_patron_active"
        ON waitlists (book_id, patron_id)
        WHERE status IN ('waiting', 'notified')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_waitlists_book_patron_active"`);
  }
}
