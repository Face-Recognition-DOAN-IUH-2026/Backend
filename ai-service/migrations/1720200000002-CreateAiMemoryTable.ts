import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiMemoryTable1720200000002 implements MigrationInterface {
  name = 'CreateAiMemoryTable1720200000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai.ai_memories (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        patron_id uuid NOT NULL,
        memory_key varchar(100) NOT NULL,
        memory_value text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_ai_memories_patron_id ON ai.ai_memories(patron_id)');
    await queryRunner.query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_memories_patron_key ON ai.ai_memories(patron_id, memory_key)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS ai.ai_memories');
  }
}
