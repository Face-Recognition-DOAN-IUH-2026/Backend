import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
