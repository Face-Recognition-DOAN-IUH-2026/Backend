import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCleanupExpiredPendingTask1740100000008 implements MigrationInterface {
  name = 'AddCleanupExpiredPendingTask1740100000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config, is_active)
      VALUES (
        'cleanup_expired_pending',
        'Revert pending states older than 30s to outside — prevents ghost stuck patrons',
        'scheduled',
        '*/1 * * * *',
        NULL,
        'cleanup_expired_pending',
        '{"pending_ttl_seconds": 30}'::jsonb,
        true
      )
      ON CONFLICT (name) DO UPDATE SET is_active = true, config = '{"pending_ttl_seconds": 30}'::jsonb, cron_expression = '*/1 * * * *'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM automation_tasks WHERE name = 'cleanup_expired_pending'`);
  }
}
