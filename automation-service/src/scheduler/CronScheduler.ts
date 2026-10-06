import { AutomationTask } from '../entities/AutomationTask';
import { AutomationRun } from '../entities/AutomationRun';
import { AppDataSource } from '../data-source';
import cron from 'node-cron';
import { eventBus, AutomationEvent } from '../events/EventBus';

// Import handlers
import { checkOverdueBorrows } from '../handlers/checkOverdueBorrows';
import { dailyStatsReport } from '../handlers/dailyStatsReport';
import { checkStaffAbsence } from '../handlers/checkStaffAbsence';
import { membershipExpiryCheck } from '../handlers/membershipExpiryCheck';
import { bookAvailabilityNotify } from '../handlers/bookAvailabilityNotify';
import { scheduleChangeNotify } from '../handlers/scheduleChangeNotify';
import { accessAnomalyAlert } from '../handlers/accessAnomalyAlert';
import { checkDueSoonBorrows } from '../handlers/checkDueSoonBorrows';
import { fineNotification } from '../handlers/fineNotification';
import { shiftReminderNotify } from '../handlers/shiftReminderNotify';
import { stalePatronCleanup } from '../handlers/stalePatronCleanup';
import { staffScheduleAutoCheckout } from '../handlers/staffScheduleAutoCheckout';
import { expireWaitlistNotifications } from '../handlers/expireWaitlistNotifications';
import { cleanupExpiredPending } from '../handlers/cleanupExpiredPending';
import { staffScheduleExpireStaleBids } from '../handlers/staffScheduleExpireStaleBids';
import { staffScheduleExpireStaleSwaps } from '../handlers/staffScheduleExpireStaleSwaps';
import { recognitionStatsRollup } from '../handlers/recognitionStatsRollup';

const taskRepo = () => AppDataSource.getRepository(AutomationTask);
const runRepo = () => AppDataSource.getRepository(AutomationRun);

type HandlerFn = (config: Record<string, any>, event?: AutomationEvent) => Promise<any>;

const handlers: Record<string, HandlerFn> = {
  check_overdue_borrows: checkOverdueBorrows,
  daily_stats_report: dailyStatsReport,
  check_staff_absence: checkStaffAbsence,
  membership_expiry_check: membershipExpiryCheck,
  book_availability_notify: bookAvailabilityNotify,
  schedule_change_notify: scheduleChangeNotify,
  access_anomaly_alert: accessAnomalyAlert,
  check_due_soon_borrows: checkDueSoonBorrows,
  fine_notification: fineNotification,
  shift_reminder_notify: shiftReminderNotify,
  stale_patron_cleanup: stalePatronCleanup,
  staff_schedule_auto_checkout: staffScheduleAutoCheckout,
  waitlist_expiry_check: expireWaitlistNotifications,
  cleanup_expired_pending: cleanupExpiredPending,
  staff_schedule_expire_stale_bids: staffScheduleExpireStaleBids,
  staff_schedule_expire_stale_swaps: staffScheduleExpireStaleSwaps,
  recognition_stats_rollup: recognitionStatsRollup,
};

export class CronScheduler {
  private scheduledTasks = new Map<string, cron.ScheduledTask>();

  async start() {
    const tasks = await taskRepo().find({ where: { isActive: true } });

    for (const task of tasks) {
      if (task.type === 'scheduled' && task.cronExpression) {
        this.scheduleTask(task);
      } else if (task.type === 'event_driven' && task.eventType) {
        this.registerEventHandler(task);
      }
    }

    console.log(`CronScheduler started with ${tasks.length} tasks`);
  }

  private scheduleTask(task: AutomationTask) {
    if (!task.cronExpression) return;

    if (!cron.validate(task.cronExpression)) {
      console.error(`Invalid cron expression for task ${task.name}: ${task.cronExpression}`);
      return;
    }

    const scheduled = cron.schedule(task.cronExpression, async () => {
      await this.executeTask(task, 'cron');
    });

    this.scheduledTasks.set(task.id, scheduled);
    console.log(`Scheduled task: ${task.name} (${task.cronExpression})`);
  }

  private registerEventHandler(task: AutomationTask) {
    if (!task.eventType) return;

    eventBus.on(task.eventType, async (event) => {
      await this.executeTask(task, 'event', event);
    });
    console.log(`Registered event handler: ${task.name} -> ${task.eventType}`);
  }

  async executeTask(task: AutomationTask, triggerType: 'cron' | 'event' | 'manual', event?: AutomationEvent) {
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
    } catch (error) {
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

export const cronScheduler = new CronScheduler();
