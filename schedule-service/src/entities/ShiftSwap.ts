import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'shift_swaps', schema: 'schedule' })
export class ShiftSwap {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'requester_staff_id' })
  requesterStaffId: string;

  @Column({ type: 'uuid', name: 'target_staff_id' })
  targetStaffId: string;

  @Column({ type: 'uuid', name: 'requester_assignment_id' })
  requesterAssignmentId: string;

  @Column({ type: 'uuid', nullable: true, name: 'target_assignment_id' })
  targetAssignmentId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ type: 'text', nullable: true, name: 'response_note' })
  responseNote: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'reviewed_by' })
  reviewedBy: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'reviewed_at' })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
