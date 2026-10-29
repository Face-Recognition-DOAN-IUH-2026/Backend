import { MigrationInterface, QueryRunner } from 'typeorm';

export class VietqrReconciliation1770500000000 implements MigrationInterface {
  name = 'VietqrReconciliation1770500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payment_orders
        ADD COLUMN IF NOT EXISTS vietqr_order_id VARCHAR(13) UNIQUE,
        ADD COLUMN IF NOT EXISTS vietqr_qr_link TEXT
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS vietqr_callbacks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id VARCHAR(100) UNIQUE NOT NULL,
        order_code VARCHAR(40),
        amount DECIMAL(12,2),
        payload JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_vietqr_callbacks_order_code" ON vietqr_callbacks (order_code)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_vietqr_callbacks_order_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS vietqr_callbacks`);
    await queryRunner.query(`
      ALTER TABLE payment_orders
        DROP COLUMN IF EXISTS vietqr_qr_link,
        DROP COLUMN IF EXISTS vietqr_order_id
    `);
  }
}
