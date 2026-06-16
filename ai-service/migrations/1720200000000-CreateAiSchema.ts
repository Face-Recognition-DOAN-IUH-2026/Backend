import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiSchema1720200000000 implements MigrationInterface {
  name = 'CreateAiSchema1720200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS ai');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai.ai_runs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        model varchar(120) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'success',
        latency_ms integer NULL,
        prompt_tokens integer NULL,
        completion_tokens integer NULL,
        snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        error_message text NULL,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai.ai_insights (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        category varchar(30) NOT NULL,
        severity varchar(20) NOT NULL,
        title varchar(255) NOT NULL,
        summary text NOT NULL,
        evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
        recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
        status varchar(20) NOT NULL DEFAULT 'open',
        run_id uuid NULL,
        generated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_ai_insights_status ON ai.ai_insights(status)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_ai_insights_generated_at ON ai.ai_insights(generated_at DESC)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS ai.ai_insights');
    await queryRunner.query('DROP TABLE IF EXISTS ai.ai_runs');
  }
}
