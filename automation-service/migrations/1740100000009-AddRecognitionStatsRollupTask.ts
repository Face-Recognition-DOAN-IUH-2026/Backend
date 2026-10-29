import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecognitionStatsRollupTask1740100000009 implements MigrationInterface {
  name = 'AddRecognitionStatsRollupTask1740100000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config, is_active)
      VALUES (
        'recognition_stats_rollup',
        'Roll up daily access recognition stats at 23:55 each night',
        'scheduled',
        '55 23 * * *',
        NULL,
        'recognition_stats_rollup',
        NULL,
        true
      )
      ON CONFLICT (name) DO UPDATE SET is_active = true, cron_expression = '55 23 * * *', handler = 'recognition_stats_rollup'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM automation_tasks WHERE name = 'recognition_stats_rollup'`);
  }
}
