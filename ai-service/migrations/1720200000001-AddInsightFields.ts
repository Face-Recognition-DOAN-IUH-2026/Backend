import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInsightFields1720200000001 implements MigrationInterface {
  name = 'AddInsightFields1720200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai.ai_insights ADD COLUMN IF NOT EXISTS reason text DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE ai.ai_insights ADD COLUMN IF NOT EXISTS confidence float DEFAULT 0.85`);
    await queryRunner.query(`ALTER TABLE ai.ai_insights ADD COLUMN IF NOT EXISTS alternatives jsonb DEFAULT '[]'::jsonb`);
    await queryRunner.query(`ALTER TABLE ai.ai_runs ADD COLUMN IF NOT EXISTS reasoning_trace text DEFAULT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai.ai_insights DROP COLUMN IF EXISTS reason`);
    await queryRunner.query(`ALTER TABLE ai.ai_insights DROP COLUMN IF EXISTS confidence`);
    await queryRunner.query(`ALTER TABLE ai.ai_insights DROP COLUMN IF EXISTS alternatives`);
    await queryRunner.query(`ALTER TABLE ai.ai_runs DROP COLUMN IF EXISTS reasoning_trace`);
  }
}
