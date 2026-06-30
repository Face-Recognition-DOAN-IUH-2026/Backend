"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cronScheduler = exports.CronScheduler = void 0;
const AutomationTask_1 = require("../entities/AutomationTask");
const AutomationRun_1 = require("../entities/AutomationRun");
const data_source_1 = require("../data-source");
const node_cron_1 = __importDefault(require("node-cron"));
const EventBus_1 = require("../events/EventBus");
// Import handlers
const checkOverdueBorrows_1 = require("../handlers/checkOverdueBorrows");
const dailyStatsReport_1 = require("../handlers/dailyStatsReport");
const checkStaffAbsence_1 = require("../handlers/checkStaffAbsence");
const membershipExpiryCheck_1 = require("../handlers/membershipExpiryCheck");
const bookAvailabilityNotify_1 = require("../handlers/bookAvailabilityNotify");
const scheduleChangeNotify_1 = require("../handlers/scheduleChangeNotify");
const accessAnomalyAlert_1 = require("../handlers/accessAnomalyAlert");
const checkDueSoonBorrows_1 = require("../handlers/checkDueSoonBorrows");
const fineNotification_1 = require("../handlers/fineNotification");
const shiftReminderNotify_1 = require("../handlers/shiftReminderNotify");
const stalePatronCleanup_1 = require("../handlers/stalePatronCleanup");
const staffScheduleAutoCheckout_1 = require("../handlers/staffScheduleAutoCheckout");
const staffScheduleExpireStaleBids_1 = require("../handlers/staffScheduleExpireStaleBids");
const staffScheduleExpireStaleSwaps_1 = require("../handlers/staffScheduleExpireStaleSwaps");
const taskRepo = () => data_source_1.AppDataSource.getRepository(AutomationTask_1.AutomationTask);
const runRepo = () => data_source_1.AppDataSource.getRepository(AutomationRun_1.AutomationRun);
const handlers = {
    check_overdue_borrows: checkOverdueBorrows_1.checkOverdueBorrows,
    daily_stats_report: dailyStatsReport_1.dailyStatsReport,
    check_staff_absence: checkStaffAbsence_1.checkStaffAbsence,
    membership_expiry_check: membershipExpiryCheck_1.membershipExpiryCheck,
    book_availability_notify: bookAvailabilityNotify_1.bookAvailabilityNotify,
    schedule_change_notify: scheduleChangeNotify_1.scheduleChangeNotify,
    access_anomaly_alert: accessAnomalyAlert_1.accessAnomalyAlert,
    check_due_soon_borrows: checkDueSoonBorrows_1.checkDueSoonBorrows,
    fine_notification: fineNotification_1.fineNotification,
    shift_reminder_notify: shiftReminderNotify_1.shiftReminderNotify,
    stale_patron_cleanup: stalePatronCleanup_1.stalePatronCleanup,
    staff_schedule_auto_checkout: staffScheduleAutoCheckout_1.staffScheduleAutoCheckout,
    staff_schedule_expire_stale_bids: staffScheduleExpireStaleBids_1.staffScheduleExpireStaleBids,
    staff_schedule_expire_stale_swaps: staffScheduleExpireStaleSwaps_1.staffScheduleExpireStaleSwaps,
};
class CronScheduler {
    constructor() {
        this.scheduledTasks = new Map();
    }
    async start() {
        const tasks = await taskRepo().find({ where: { isActive: true } });
        for (const task of tasks) {
            if (task.type === 'scheduled' && task.cronExpression) {
                this.scheduleTask(task);
            }
            else if (task.type === 'event_driven' && task.eventType) {
                this.registerEventHandler(task);
            }
        }
        console.log(`CronScheduler started with ${tasks.length} tasks`);
    }
    scheduleTask(task) {
        if (!task.cronExpression)
            return;
        if (!node_cron_1.default.validate(task.cronExpression)) {
            console.error(`Invalid cron expression for task ${task.name}: ${task.cronExpression}`);
            return;
        }
        const scheduled = node_cron_1.default.schedule(task.cronExpression, async () => {
            await this.executeTask(task, 'cron');
        });
        this.scheduledTasks.set(task.id, scheduled);
        console.log(`Scheduled task: ${task.name} (${task.cronExpression})`);
    }
    registerEventHandler(task) {
        if (!task.eventType)
            return;
        EventBus_1.eventBus.on(task.eventType, async (event) => {
            await this.executeTask(task, 'event', event);
        });
        console.log(`Registered event handler: ${task.name} -> ${task.eventType}`);
    }
    async executeTask(task, triggerType, event) {
        const run = runRepo().create({
            taskId: task.id,
            status: 'running',
            triggerType,
            input: event || null,
        });
        const savedRun = await runRepo().save(run);
        const handler = handlers[task.handler];
        if (!handler) {
            savedRun.status = 'failed';
            savedRun.errorMessage = `Handler not found: ${task.handler}`;
            savedRun.completedAt = new Date();
            await runRepo().save(savedRun);
            return;
        }
        try {
            const result = await handler(task.config || {}, event);
            savedRun.status = 'success';
            savedRun.output = result;
            savedRun.completedAt = new Date();
        }
        catch (error) {
            savedRun.status = 'failed';
            savedRun.errorMessage = error instanceof Error ? error.message : String(error);
            savedRun.completedAt = new Date();
        }
        await runRepo().save(savedRun);
        // Update task last_run_at
        task.lastRunAt = new Date();
        await taskRepo().save(task);
    }
    async stop() {
        for (const [id, scheduled] of this.scheduledTasks) {
            scheduled.stop();
        }
        this.scheduledTasks.clear();
        console.log('CronScheduler stopped');
    }
}
exports.CronScheduler = CronScheduler;
exports.cronScheduler = new CronScheduler();
