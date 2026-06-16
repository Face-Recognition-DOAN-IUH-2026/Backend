import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Book } from './Book';

@Entity({ name: 'borrow_slips' })
export class BorrowSlip {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'patron_id', type: 'uuid' })
  patronId!: string;

  @Column({ name: 'borrow_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  borrowAt!: Date;

  @Column({ name: 'due_at', type: 'timestamp' })
  dueAt!: Date;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ name: 'created_by_email', type: 'varchar', length: 255, nullable: true })
  createdByEmail!: string | null;

  @Column({ name: 'total_items', type: 'int', default: 0 })
  totalItems!: number;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}
