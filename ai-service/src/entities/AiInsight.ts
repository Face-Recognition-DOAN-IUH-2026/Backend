import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { config } from '../config';

@Entity({ schema: config.db.schema, name: 'ai_insights' })
export class AiInsight {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30 })
  category!: string;

  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  summary!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  evidence!: Array<{ label: string; value: string | number }>;

  @Column({ name: 'recommended_actions', type: 'jsonb', default: () => "'[]'::jsonb" })
  recommendedActions!: string[];

  @Column({ type: 'text', default: '' })
  reason!: string;

  @Column({ type: 'float', default: 0.85 })
  confidence!: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  alternatives!: string[];

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status!: string;

  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId!: string | null;

  @Column({ name: 'generated_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  generatedAt!: Date;
}
