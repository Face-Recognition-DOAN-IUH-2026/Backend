import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationTables1719400000000 implements MigrationInterface {
  name = 'CreateAutomationTables1719400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS automation_tasks (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name varchar(100) UNIQUE NOT NULL,
        description text,
        type varchar(20) NOT NULL,
        cron_expression varchar(50),
        event_type varchar(50),
        handler varchar(100) NOT NULL,
        config jsonb,
        is_active boolean DEFAULT true,
        last_run_at timestamptz,
        next_run_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS automation_runs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        task_id uuid NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
        status varchar(20) NOT NULL,
        trigger_type varchar(20) NOT NULL,
        input jsonb,
        output jsonb,
        error_message text,
        started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at timestamptz
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_automation_runs_task ON automation_runs(task_id, started_at DESC)`);

    // Seed default tasks
    await queryRunner.query(`
      INSERT INTO automation_tasks (name, description, type, cron_expression, handler, config) VALUES
        ('check_overdue_borrows', 'Check for overdue books and notify patrons', 'scheduled', '0 * * * *', 'check_overdue_borrows', '{"notify_patrons": true}'),
        ('daily_stats_report', 'Generate daily library statistics report', 'scheduled', '0 17 * * *', 'daily_stats_report', '{"notify_roles": ["admin", "staff"]}'),
        ('check_staff_absence', 'Check for absent staff and alert admin', 'scheduled', '30 * * * *', 'check_staff_absence', '{"notify_roles": ["admin"]}'),
        ('membership_expiry_check', 'Check for expiring memberships', 'scheduled', '0 9 * * *', 'membership_expiry_check', '{"days_before": 7}'),
        ('book_availability_notify', 'Notify patrons when reserved books become available', 'event_driven', NULL, 'book_availability_notify', NULL),
        ('schedule_change_notify', 'Notify staff when schedule changes', 'event_driven', NULL, 'schedule_change_notify', NULL),
        ('access_anomaly_alert', 'Detect access anomalies', 'scheduled', '15 * * * *', 'access_anomaly_alert', '{"check_night_hours": true}')
      ON CONFLICT (name) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS automation_runs`);
    await queryRunner.query(`DROP TABLE IF EXISTS automation_tasks`);
  }
}
