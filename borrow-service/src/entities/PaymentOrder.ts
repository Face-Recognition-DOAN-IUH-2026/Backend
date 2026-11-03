import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type PaymentOrderStatus =
  | 'pending'
  | 'completed'
  | 'expired'
  | 'cancelled'
  /** Money arrived, but part or all of the debt was already settled elsewhere. */
  | 'reconcile_needed'
  /** Staff confirmed the duplicate payment was refunded out-of-band. */
  | 'refunded';
export type PaymentMethodType = 'vietqr' | 'payos' | 'vnpay' | 'cash';

@Entity('payment_orders')
@Index('IDX_payment_orders_status_created_at', ['status', 'createdAt'])
export class PaymentOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'order_code', type: 'varchar', length: 40 })
  orderCode: string;

  @Index()
  @Column({ name: 'patron_id', type: 'uuid' })
  patronId: string;

  @Column({ name: 'amount', type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'pending' })
  status: PaymentOrderStatus;

  @Column({ name: 'payment_method', type: 'varchar', length: 20, default: 'vietqr' })
  paymentMethod: PaymentMethodType;

  @Column({ name: 'gateway_trans_id', type: 'varchar', length: 100, nullable: true })
  gatewayTransId: string | null;

  @Column({ name: 'qr_data', type: 'text', nullable: true })
  qrData: string | null;

  @Column({ name: 'qr_url', type: 'text', nullable: true })
  qrUrl: string | null;

  @Column({ name: 'record_ids', type: 'jsonb' })
  recordIds: string[];

  @Column({ name: 'webhook_payload', type: 'jsonb', nullable: true })
  webhookPayload: Record<string, any> | null;

  // --- Settlement idempotency (BLF-PAY-01) -----------------------------------
  // Records this order actually settled. Empty when nothing could be settled
  // because the debt had already been paid at the counter.
  @Column({ name: 'settled_record_ids', type: 'jsonb', default: () => "'[]'::jsonb" })
  settledRecordIds: string[];

  // Records that were already paid before this order settled. Their payment
  // fields are never touched; the amount is refundable.
  @Column({ name: 'already_paid_record_ids', type: 'jsonb', default: () => "'[]'::jsonb" })
  alreadyPaidRecordIds: string[];

  @Column({ name: 'reconcile_reason', type: 'varchar', length: 64, nullable: true })
  reconcileReason: string | null;

  @Column({ name: 'reconcile_amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  reconcileAmount: number | null;

  @Column({ name: 'reconcile_ack_by', type: 'uuid', nullable: true })
  reconcileAckBy: string | null;

  @Column({ name: 'reconcile_ack_note', type: 'varchar', length: 500, nullable: true })
  reconcileAckNote: string | null;

  @Column({ name: 'reconcile_ack_at', type: 'timestamp', nullable: true })
  reconcileAckAt: Date | null;

  @Column({ name: 'vietqr_order_id', type: 'varchar', length: 13, nullable: true, unique: true })
  vietqrOrderId: string | null;

  @Column({ name: 'vietqr_qr_link', type: 'text', nullable: true })
  vietqrQrLink: string | null;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
