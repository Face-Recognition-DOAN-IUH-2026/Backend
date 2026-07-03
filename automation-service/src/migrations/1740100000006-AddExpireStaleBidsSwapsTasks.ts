import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpireStaleBidsSwapsTasks1740100000006 implements MigrationInterface {
  name = 'AddExpireStaleBidsSwapsTasks1740100000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config, is_active)
      VALUES
        ('staff_schedule_expire_stale_bids', 'Warn at 48h and expire stale shift bids at 72h', 'scheduled', '0 */6 * * *', NULL, 'staff_schedule_expire_stale_bids', NULL, true),
        ('staff_schedule_expire_stale_swaps', 'Warn at 48h and expire stale shift swaps at 72h', 'scheduled', '0 */6 * * *', NULL, 'staff_schedule_expire_stale_swaps', NULL, true)
      ON CONFLICT (name) DO UPDATE SET is_active = true, cron_expression = '0 */6 * * *'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM automation_tasks WHERE name IN ('staff_schedule_expire_stale_bids', 'staff_schedule_expire_stale_swaps')`);
  }
}
