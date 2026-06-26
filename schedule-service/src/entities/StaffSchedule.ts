import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Index(['staffId', 'workDate', 'status'])
@Entity({ name: 'staff_schedules', schema: 'schedule' })
export class StaffSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'staff_id' })
  staffId: string;

  @Column({ type: 'uuid', name: 'shift_id' })
  shiftId: string;

  @Column({ type: 'uuid', name: 'zone_id' })
  zoneId: string;

  @Column({ type: 'date', name: 'work_date' })
  workDate: string;

  @Column({ type: 'varchar', length: 30, default: 'scheduled' })
  status: string;

  @Column({ type: 'uuid', nullable: true, name: 'assigned_by' })
  assignedBy: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
