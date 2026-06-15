import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { config } from '../config';

@Entity({ schema: config.db.schema, name: 'access_logs' })
@Index(['accessTime'])
@Index(['patronId'])
@Index(['cameraId'])
export class AccessLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'patron_id', type: 'uuid', nullable: true })
  patronId!: string | null;

  @Column({ name: 'access_type', type: 'varchar', length: 10 })
  accessType!: 'entry' | 'exit';

  @Column({ name: 'verify_method', type: 'varchar', length: 20, default: 'face' })
  verifyMethod!: string;

  @Column({ type: 'float', nullable: true })
  confidence!: number | null;

  @Column({ name: 'camera_id', type: 'varchar', length: 50 })
  cameraId!: string;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'success' })
  status!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 80, nullable: true })
  eventId!: string | null;

  @Column({ type: 'varchar', length: 50, default: 'access-service' })
  source!: string;

  @Column({ name: 'access_time', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  accessTime!: Date;
}
