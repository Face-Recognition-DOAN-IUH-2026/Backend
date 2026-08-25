import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { config } from '../config';

@Entity({ schema: config.db.schema, name: 'ai_memories' })
export class AiMemory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'patron_id', type: 'uuid' })
  patronId!: string;

  @Column({ name: 'memory_key', type: 'varchar', length: 100 })
  memoryKey!: string;

  @Column({ name: 'memory_value', type: 'text' })
  memoryValue!: string;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}
