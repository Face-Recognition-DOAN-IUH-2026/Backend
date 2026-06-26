import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBorrowReservation1719000000000 implements MigrationInterface {
  name = 'AddBorrowReservation1719000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE borrow_records
      ADD COLUMN IF NOT EXISTS fine_amount DECIMAL(10,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS fine_paid BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS renewal_count INTEGER DEFAULT 0
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS book_reservations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patron_id UUID NOT NULL,
        book_id UUID NOT NULL,
        reserved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        notified_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_reservations_patron ON book_reservations(patron_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_reservations_book ON book_reservations(book_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_reservations_status ON book_reservations(status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS book_reservations`);
    await queryRunner.query(`
      ALTER TABLE borrow_records
      DROP COLUMN IF EXISTS fine_amount,
      DROP COLUMN IF EXISTS fine_paid,
      DROP COLUMN IF EXISTS renewal_count
    `);
  }
}
