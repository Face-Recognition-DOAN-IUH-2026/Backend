import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Return payment fields: damage_fee, payment_method, payment_ref, paid_at,
 * plus the (fine_paid, return_at) index backing the unpaid-debt ledger query.
 */
export class AddReturnPaymentFields1770100000000 implements MigrationInterface {
  name = 'AddReturnPaymentFields1770100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE borrow_records ADD COLUMN IF NOT EXISTS damage_fee DECIMAL(12,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE borrow_records ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE borrow_records ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE borrow_records ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_borrow_records_fine_paid_return_at" ON borrow_records (fine_paid, return_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_borrow_records_fine_paid_return_at"`);
    await queryRunner.query(`ALTER TABLE borrow_records DROP COLUMN IF EXISTS paid_at`);
    await queryRunner.query(`ALTER TABLE borrow_records DROP COLUMN IF EXISTS payment_ref`);
    await queryRunner.query(`ALTER TABLE borrow_records DROP COLUMN IF EXISTS payment_method`);
    await queryRunner.query(`ALTER TABLE borrow_records DROP COLUMN IF EXISTS damage_fee`);
  }
}
