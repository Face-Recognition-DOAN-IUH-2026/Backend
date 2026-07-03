import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStaffScheduleAutoCheckoutTask1740100000005 implements MigrationInterface {
  name = 'AddStaffScheduleAutoCheckoutTask1740100000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config, is_active)
      VALUES
        ('staff_schedule_auto_checkout', 'Auto-checkout stale staff schedule assignments at end of day', 'scheduled', '59 23 * * *', NULL, 'staff_schedule_auto_checkout', NULL, true)
      ON CONFLICT (name) DO UPDATE SET is_active = true, cron_expression = '59 23 * * *'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM automation_tasks WHERE name = 'staff_schedule_auto_checkout'`);
  }
}