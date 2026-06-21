import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'automation_runs' })
@Index(['taskId', 'startedAt'])
export class AutomationRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: 'running' | 'success' | 'failed';

  @Column({ name: 'trigger_type', type: 'varchar', length: 20 })
  triggerType!: 'cron' | 'event' | 'manual';

  @Column({ type: 'jsonb', nullable: true })
  input!: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  output!: Record<string, any> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
