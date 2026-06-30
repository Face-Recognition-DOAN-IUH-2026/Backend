"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivateAllAutomationTasks1740100000004 = void 0;
class ActivateAllAutomationTasks1740100000004 {
    constructor() {
        this.name = 'ActivateAllAutomationTasks1740100000004';
    }
    async up(queryRunner) {
        // Ensure all known tasks exist and are active
        await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config, is_active)
      VALUES
        ('shift_reminder_notify', 'Remind staff of their shifts tomorrow', 'scheduled', '0 19 * * *', NULL, 'shift_reminder_notify', NULL, true),
        ('check_due_soon_borrows', 'Notify patrons whose books are due within 3 days', 'scheduled', '0 9 * * *', NULL, 'check_due_soon_borrows', '{"days_before": 3}', true),
        ('stale_patron_cleanup', 'Auto-exit patrons inside >24h at 2am daily', 'scheduled', '0 2 * * *', NULL, 'stale_patron_cleanup', '{"max_inside_hours": 24}', true),
        ('fine_notification', 'Send notification when a fine is incurred', 'event_driven', NULL, 'fine.incurred', 'fine_notification', NULL, true)
      ON CONFLICT (name) DO UPDATE SET is_active = true, config = EXCLUDED.config, cron_expression = COALESCE(EXCLUDED.cron_expression, automation_tasks.cron_expression)
    `);
        // Also ensure the original 7 tasks are active
        await queryRunner.query(`
      UPDATE automation_tasks
      SET is_active = true
      WHERE name IN (
        'check_overdue_borrows', 'daily_stats_report', 'check_staff_absence',
        'membership_expiry_check', 'book_availability_notify',
        'schedule_change_notify', 'access_anomaly_alert'
      )
    `);
    }
    async down(queryRunner) {
        // No down needed - this is a one-time activation
    }
}
exports.ActivateAllAutomationTasks1740100000004 = ActivateAllAutomationTasks1740100000004;
