import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'automation_tasks' })
export class AutomationTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 20 })
  type!: 'scheduled' | 'event_driven';

  @Column({ name: 'cron_expression', type: 'varchar', length: 50, nullable: true })
  cronExpression!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 50, nullable: true })
  eventType!: string | null;

  @Column({ type: 'varchar', length: 100 })
  handler!: string;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, any> | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  lastRunAt!: Date | null;

  @Column({ name: 'next_run_at', type: 'timestamptz', nullable: true })
  nextRunAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
}
