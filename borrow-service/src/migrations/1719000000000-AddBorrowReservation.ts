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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE borrow_records
      DROP COLUMN IF EXISTS fine_amount,
      DROP COLUMN IF EXISTS fine_paid,
      DROP COLUMN IF EXISTS renewal_count
    `);
  }
}
