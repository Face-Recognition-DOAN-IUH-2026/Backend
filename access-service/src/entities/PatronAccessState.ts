import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { config } from '../config';

@Entity({ schema: config.db.schema, name: 'patron_access_states' })
@Index(['patronId'], { unique: true })
@Index(['currentStatus'])
export class PatronAccessState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'patron_id', type: 'uuid' })
  patronId!: string;

  @Column({ name: 'current_status', type: 'varchar', length: 20, default: 'outside' })
  currentStatus!: 'inside' | 'outside' | 'pending';

  @Column({ name: 'last_entry_at', type: 'timestamptz', nullable: true })
  lastEntryAt!: Date | null;

  @Column({ name: 'last_entry_camera', type: 'varchar', length: 50, nullable: true })
  lastEntryCamera!: string | null;

  @Column({ name: 'last_exit_at', type: 'timestamptz', nullable: true })
  lastExitAt!: Date | null;

  @Column({ name: 'last_exit_camera', type: 'varchar', length: 50, nullable: true })
  lastExitCamera!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
