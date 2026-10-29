import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDueSoonAndFineTasks1740100000000 implements MigrationInterface {
  name = 'AddDueSoonAndFineTasks1740100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config) VALUES
        ('check_due_soon_borrows', 'Notify patrons whose books are due within 3 days', 'scheduled', '0 9 * * *', NULL, 'check_due_soon_borrows', '{"days_before": 3}'),
        ('fine_notification', 'Send notification when a fine is incurred', 'event_driven', NULL, 'fine.incurred', 'fine_notification', NULL)
      ON CONFLICT (name) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM automation_tasks WHERE name IN ('check_due_soon_borrows', 'fine_notification')`);
  }
}
