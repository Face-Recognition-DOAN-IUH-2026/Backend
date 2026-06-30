"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddShiftReminderTask1740100000001 = void 0;
class AddShiftReminderTask1740100000001 {
    constructor() {
        this.name = 'AddShiftReminderTask1740100000001';
    }
    async up(queryRunner) {
        await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config) VALUES
        ('shift_reminder_notify', 'Remind staff of their shifts tomorrow', 'scheduled', '0 19 * * *', NULL, 'shift_reminder_notify', NULL)
      ON CONFLICT (name) DO NOTHING
    `);
    }
    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM automation_tasks WHERE name = 'shift_reminder_notify'`);
    }
}
exports.AddShiftReminderTask1740100000001 = AddShiftReminderTask1740100000001;
