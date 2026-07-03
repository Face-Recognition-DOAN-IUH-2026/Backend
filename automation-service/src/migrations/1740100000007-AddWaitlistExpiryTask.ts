import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWaitlistExpiryTask1740100000007 implements MigrationInterface {
  name = 'AddWaitlistExpiryTask1740100000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config, is_active)
      VALUES (
        'waitlist_expiry_check',
        'Check for expired waitlist notifications (>24h) and advance to next patron in FIFO queue',
        'scheduled',
        '0 * * * *',
        NULL,
        'waitlist_expiry_check',
        '{"expiryHours": 24}'::jsonb,
        true
      )
      ON CONFLICT (name) DO UPDATE SET is_active = true, cron_expression = '0 * * * *'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM automation_tasks WHERE name = 'waitlist_expiry_check'`);
  }
}
