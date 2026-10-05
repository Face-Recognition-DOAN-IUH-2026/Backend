import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Book copy per-copy management: condition/status/imported_at on copies,
 * price on books, return_condition on borrow records, plus the
 * book_copy_condition_history audit table and its backfill.
 */
export class AddCopyManagementFields1770000000000 implements MigrationInterface {
  name = 'AddCopyManagementFields1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS price DECIMAL(12,2)`);

    await queryRunner.query(
      `ALTER TABLE book_copies ADD COLUMN IF NOT EXISTS condition VARCHAR(30) NOT NULL DEFAULT 'good'`,
    );
    await queryRunner.query(
      `ALTER TABLE book_copies ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'available'`,
    );
    await queryRunner.query(`ALTER TABLE book_copies ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP`);

    await queryRunner.query(
      `ALTER TABLE borrow_records ADD COLUMN IF NOT EXISTS return_condition VARCHAR(30)`,
    );

    // Backfill: legacy copies get condition='good'; status derived from the
    // existing dual-write field is_available; imported_at falls back to created_at.
    await queryRunner.query(
      `UPDATE book_copies SET status = 'borrowed' WHERE status = 'available' AND is_available = false`,
    );
    await queryRunner.query(
      `UPDATE book_copies SET status = 'available' WHERE status = 'borrowed' AND is_available = true`,
    );
    await queryRunner.query(`UPDATE book_copies SET imported_at = created_at WHERE imported_at IS NULL`);
    await queryRunner.query(`ALTER TABLE book_copies ALTER COLUMN imported_at SET DEFAULT CURRENT_TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE book_copies ALTER COLUMN imported_at SET NOT NULL`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS book_copy_condition_history (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        copy_id uuid NOT NULL REFERENCES book_copies(id) ON DELETE CASCADE,
        previous_condition varchar(30),
        condition varchar(30) NOT NULL,
        changed_by uuid,
        note text,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_book_copy_condition_history_copy_created"
      ON book_copy_condition_history (copy_id, created_at)
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_book_copies_book_status" ON book_copies (book_id, status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_book_copies_book_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_book_copy_condition_history_copy_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS book_copy_condition_history`);
    await queryRunner.query(`ALTER TABLE borrow_records DROP COLUMN IF EXISTS return_condition`);
    await queryRunner.query(
      `ALTER TABLE book_copies ALTER COLUMN imported_at DROP NOT NULL, ALTER COLUMN imported_at DROP DEFAULT`,
    );
    await queryRunner.query(`ALTER TABLE book_copies DROP COLUMN IF EXISTS imported_at`);
    await queryRunner.query(`ALTER TABLE book_copies DROP COLUMN IF EXISTS status`);
    await queryRunner.query(`ALTER TABLE book_copies DROP COLUMN IF EXISTS condition`);
    await queryRunner.query(`ALTER TABLE books DROP COLUMN IF EXISTS price`);
  }
}
