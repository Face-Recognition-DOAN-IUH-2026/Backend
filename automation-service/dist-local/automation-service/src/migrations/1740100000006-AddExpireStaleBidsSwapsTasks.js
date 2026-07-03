"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddExpireStaleBidsSwapsTasks1740100000006 = void 0;
class AddExpireStaleBidsSwapsTasks1740100000006 {
    constructor() {
        this.name = 'AddExpireStaleBidsSwapsTasks1740100000006';
    }
    async up(queryRunner) {
        await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config, is_active)
      VALUES
        ('staff_schedule_expire_stale_bids', 'Warn at 48h and expire stale shift bids at 72h', 'scheduled', '0 */6 * * *', NULL, 'staff_schedule_expire_stale_bids', NULL, true),
        ('staff_schedule_expire_stale_swaps', 'Warn at 48h and expire stale shift swaps at 72h', 'scheduled', '0 */6 * * *', NULL, 'staff_schedule_expire_stale_swaps', NULL, true)
      ON CONFLICT (name) DO UPDATE SET is_active = true, cron_expression = '0 */6 * * *'
    `);
    }
    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM automation_tasks WHERE name IN ('staff_schedule_expire_stale_bids', 'staff_schedule_expire_stale_swaps')`);
    }
}
exports.AddExpireStaleBidsSwapsTasks1740100000006 = AddExpireStaleBidsSwapsTasks1740100000006;
