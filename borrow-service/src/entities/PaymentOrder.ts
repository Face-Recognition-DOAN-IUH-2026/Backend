import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type PaymentOrderStatus = 'pending' | 'completed' | 'expired' | 'cancelled';
export type PaymentMethodType = 'vietqr' | 'payos' | 'vnpay' | 'cash';

@Entity('payment_orders')
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
