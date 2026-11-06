import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BLF-PAY-01 — settlement idempotency.
 *
 * A VietQR/payOS payment can arrive after the patron already paid the same fine
 * at the counter. Settlement used to overwrite `payment_method`, `payment_ref`
 * and `paid_at` on those records, charging the patron twice with only one
 * ledger entry. The order is now quarantined as `reconcile_needed` and these
 * columns record what happened so staff can refund manually.
 *
 * Note: `status` stays VARCHAR(20). 'reconcile_needed' is 16 characters and
 * 'refunded' is 8, so no column widening is required.
 */
export class PaymentSettlementIdempotency1770600000000 implements MigrationInterface {
  name = 'PaymentSettlementIdempotency1770600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payment_orders
        ADD COLUMN IF NOT EXISTS settled_record_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS already_paid_record_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS reconcile_reason         VARCHAR(64),
        ADD COLUMN IF NOT EXISTS reconcile_amount         DECIMAL(12,2),
        ADD COLUMN IF NOT EXISTS reconcile_ack_by         UUID,
        ADD COLUMN IF NOT EXISTS reconcile_ack_note       VARCHAR(500),
        ADD COLUMN IF NOT EXISTS reconcile_ack_at         TIMESTAMP
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_orders_status_created_at"
        ON payment_orders (status, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_orders_status_created_at"`);
    await queryRunner.query(`
      ALTER TABLE payment_orders
        DROP COLUMN IF EXISTS reconcile_ack_at,
        DROP COLUMN IF EXISTS reconcile_ack_note,
        DROP COLUMN IF EXISTS reconcile_ack_by,
        DROP COLUMN IF EXISTS reconcile_amount,
        DROP COLUMN IF EXISTS reconcile_reason,
        DROP COLUMN IF EXISTS already_paid_record_ids,
        DROP COLUMN IF EXISTS settled_record_ids
    `);
  }
}
