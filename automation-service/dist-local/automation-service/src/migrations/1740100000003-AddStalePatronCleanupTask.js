"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddStalePatronCleanupTask1740100000003 = void 0;
class AddStalePatronCleanupTask1740100000003 {
    constructor() {
        this.name = 'AddStalePatronCleanupTask1740100000003';
    }
    async up(queryRunner) {
        await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config) VALUES
        ('stale_patron_cleanup', 'Auto-exit patrons inside >24h at 2am daily', 'scheduled', '0 2 * * *', NULL, 'stale_patron_cleanup', '{"max_inside_hours": 24}')
      ON CONFLICT (name) DO NOTHING
    `);
        await queryRunner.query(`
      UPDATE automation_tasks SET config = '{"stale_hours": 8}' WHERE name = 'access_anomaly_alert' AND (config IS NULL OR config = 'null')
    `);
    }
    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM automation_tasks WHERE name = 'stale_patron_cleanup'`);
    }
}
exports.AddStalePatronCleanupTask1740100000003 = AddStalePatronCleanupTask1740100000003;
