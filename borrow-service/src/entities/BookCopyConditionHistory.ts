import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index(['copyId', 'createdAt'])
@Entity({ name: 'book_copy_condition_history' })
export class BookCopyConditionHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'copy_id', type: 'uuid' })
  copyId!: string;

  @Column({ name: 'previous_condition', type: 'varchar', length: 30, nullable: true })
  previousCondition!: string | null;

  @Column({ type: 'varchar', length: 30 })
  condition!: string;

  @Column({ name: 'changed_by', type: 'uuid', nullable: true })
  changedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
}
