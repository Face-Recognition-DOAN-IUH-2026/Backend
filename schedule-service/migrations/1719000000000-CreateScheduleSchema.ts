import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScheduleSchema1719000000000 implements MigrationInterface {
  name = 'CreateScheduleSchema1719000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS schedule`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS schedule.library_zones (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        floor INT NOT NULL,
        zone_name VARCHAR(100) NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS schedule.staff_shifts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        min_staff INT NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS schedule.staff_availability_requests (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        staff_id UUID NOT NULL,
        date_from DATE NOT NULL,
        date_to DATE NOT NULL,
        type VARCHAR(30) NOT NULL DEFAULT 'unavailable',
        reason TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        reviewed_by UUID,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT chk_availability_date_range CHECK (date_to >= date_from)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS schedule.staff_schedule_templates (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        day_of_week INT NOT NULL,
        shift_id UUID NOT NULL,
        zone_id UUID NOT NULL,
        staff_id UUID NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT chk_template_day CHECK (day_of_week >= 0 AND day_of_week <= 6)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS schedule.staff_schedules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        staff_id UUID NOT NULL,
        shift_id UUID NOT NULL,
        zone_id UUID NOT NULL,
        work_date DATE NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
        assigned_by UUID,
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS schedule.staff_attendance (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        schedule_id UUID NOT NULL,
        staff_id UUID NOT NULL,
        check_in_at TIMESTAMP,
        check_out_at TIMESTAMP,
        status VARCHAR(30) NOT NULL,
        method VARCHAR(30) NOT NULL DEFAULT 'web',
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS schedule.schedule_audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        action VARCHAR(80) NOT NULL,
        entity_type VARCHAR(80) NOT NULL,
        entity_id UUID,
        actor_id UUID,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_schedule_zones_floor ON schedule.library_zones(floor)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_schedule_availability_staff_dates ON schedule.staff_availability_requests(staff_id, date_from, date_to, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_schedule_templates_day ON schedule.staff_schedule_templates(day_of_week, is_active)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_schedule_assignments_staff_date ON schedule.staff_schedules(staff_id, work_date)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_schedule_assignments_date_zone ON schedule.staff_schedules(work_date, zone_id, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_schedule_attendance_schedule ON schedule.staff_attendance(schedule_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_schedule_audit_entity ON schedule.schedule_audit_logs(entity_type, entity_id, created_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS schedule.schedule_audit_logs`);
    await queryRunner.query(`DROP TABLE IF EXISTS schedule.staff_attendance`);
    await queryRunner.query(`DROP TABLE IF EXISTS schedule.staff_schedules`);
    await queryRunner.query(`DROP TABLE IF EXISTS schedule.staff_schedule_templates`);
    await queryRunner.query(`DROP TABLE IF EXISTS schedule.staff_availability_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS schedule.staff_shifts`);
    await queryRunner.query(`DROP TABLE IF EXISTS schedule.library_zones`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS schedule`);
  }
}
