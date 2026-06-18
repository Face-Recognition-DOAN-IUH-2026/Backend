import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { config } from '../config';

@Entity({ schema: config.db.schema, name: 'ai_runs' })
export class AiRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  model!: string;

  @Column({ type: 'varchar', length: 20, default: 'success' })
  status!: string;

  @Column({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs!: number | null;

  @Column({ name: 'prompt_tokens', type: 'integer', nullable: true })
  promptTokens!: number | null;

  @Column({ name: 'completion_tokens', type: 'integer', nullable: true })
  completionTokens!: number | null;

  @Column({ name: 'snapshot', type: 'jsonb', default: () => "'{}'::jsonb" })
  snapshot!: Record<string, unknown>;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'reasoning_trace', type: 'text', nullable: true })
  reasoningTrace!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
}
