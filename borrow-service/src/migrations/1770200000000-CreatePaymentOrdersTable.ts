import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentOrdersTable1770200000000 implements MigrationInterface {
  name = 'CreatePaymentOrdersTable1770200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payment_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_code VARCHAR(40) UNIQUE NOT NULL,
        patron_id UUID NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        payment_method VARCHAR(20) NOT NULL DEFAULT 'vietqr',
        gateway_trans_id VARCHAR(100),
        qr_data TEXT,
        qr_url TEXT,
        record_ids JSONB NOT NULL,
        webhook_payload JSONB,
        expires_at TIMESTAMP NOT NULL,
        paid_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_orders_order_code" ON payment_orders (order_code)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_orders_patron_id" ON payment_orders (patron_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_orders_patron_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_orders_order_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS payment_orders`);
  }
}
