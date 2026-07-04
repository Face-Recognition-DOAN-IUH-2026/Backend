import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { config } from '../config';

@Entity({ schema: config.db.schema, name: 'kiosk_approval_requests' })
@Index(['eventCode'], { unique: true })
@Index(['status'])
export class KioskApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_code', type: 'varchar', length: 10, unique: true })
  eventCode!: string;

  @Column({ name: 'kiosk_device_id', type: 'varchar', length: 50 })
  kioskDeviceId!: string;

  @Column({ name: 'patron_id', type: 'uuid', nullable: true })
  patronId!: string | null;

  @Column({ name: 'patron_student_code', type: 'varchar', length: 20, nullable: true })
  patronStudentCode!: string | null;

  @Column({ name: 'fail_image_url', type: 'text', nullable: true })
  failImageUrl!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  isbns!: string | null;

  @Column({ name: 'device_auth_token', type: 'text' })
  deviceAuthToken!: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: string;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
