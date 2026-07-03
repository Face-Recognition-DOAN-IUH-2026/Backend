import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Index(['scheduleId'])
@Index(['staffId', 'checkInAt'])
@Index(['status', 'checkInAt'])
@Entity({ name: 'staff_attendance', schema: 'schedule' })
export class StaffAttendance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'schedule_id' })
  scheduleId: string;

  @Column({ type: 'uuid', name: 'staff_id' })
  staffId: string;

  @Column({ type: 'timestamp', nullable: true, name: 'check_in_at' })
  checkInAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'check_out_at' })
  checkOutAt: Date | null;

  @Column({ type: 'varchar', length: 30 })
  status: string;

  @Column({ type: 'varchar', length: 30, default: 'web' })
  method: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'invalidated_reason' })
  invalidatedReason: string | null;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
