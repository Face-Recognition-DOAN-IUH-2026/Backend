import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Idempotency ledger for VietQR transaction-sync callbacks.
 * One row per bank transaction (transactionid is globally unique per VietQR docs),
 * so duplicate callbacks can never settle the same debt twice.
 */
@Entity('vietqr_callbacks')
export class VietqrCallback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'transaction_id', type: 'varchar', length: 100 })
  transactionId: string;

  @Column({ name: 'order_code', type: 'varchar', length: 40, nullable: true })
  orderCode: string | null;

  @Column({ name: 'amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  amount: number | null;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
