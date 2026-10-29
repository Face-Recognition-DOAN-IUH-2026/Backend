import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShiftReminderTask1740100000001 implements MigrationInterface {
  name = 'AddShiftReminderTask1740100000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config) VALUES
        ('shift_reminder_notify', 'Remind staff of their shifts tomorrow', 'scheduled', '0 19 * * *', NULL, 'shift_reminder_notify', NULL)
      ON CONFLICT (name) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM automation_tasks WHERE name = 'shift_reminder_notify'`);
  }
}