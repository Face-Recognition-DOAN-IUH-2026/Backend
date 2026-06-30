"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddDueSoonAndFineTasks1740100000000 = void 0;
class AddDueSoonAndFineTasks1740100000000 {
    constructor() {
        this.name = 'AddDueSoonAndFineTasks1740100000000';
    }
    async up(queryRunner) {
        await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config) VALUES
        ('check_due_soon_borrows', 'Notify patrons whose books are due within 3 days', 'scheduled', '0 9 * * *', NULL, 'check_due_soon_borrows', '{"days_before": 3}'),
        ('fine_notification', 'Send notification when a fine is incurred', 'event_driven', NULL, 'fine.incurred', 'fine_notification', NULL)
      ON CONFLICT (name) DO NOTHING
    `);
    }
    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM automation_tasks WHERE name IN ('check_due_soon_borrows', 'fine_notification')`);
    }
}
exports.AddDueSoonAndFineTasks1740100000000 = AddDueSoonAndFineTasks1740100000000;
