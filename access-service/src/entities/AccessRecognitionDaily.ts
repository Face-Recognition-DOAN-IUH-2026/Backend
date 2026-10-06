import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { config } from '../config';

@Entity({ schema: config.db.schema, name: 'access_recognition_daily' })
@Index(['statDate', 'cameraId'], { unique: true })
export class AccessRecognitionDaily {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'stat_date', type: 'date' })
  statDate!: string;

  @Column({ name: 'camera_id', type: 'varchar', length: 50 })
  cameraId!: string;

  @Column({ type: 'int', default: 0 })
  granted!: number;

  @Column({ type: 'int', default: 0 })
  spoof!: number;

  @Column({ name: 'no_match', type: 'int', default: 0 })
  noMatch!: number;

  @Column({ type: 'int', default: 0 })
  other!: number;

  @Column({ name: 'avg_confidence', type: 'double precision', nullable: true })
  avgConfidence!: number | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}
