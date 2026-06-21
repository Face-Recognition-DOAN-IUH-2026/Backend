import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixEventTypesAndSeedData1719400000001 implements MigrationInterface {
  name = 'FixEventTypesAndSeedData1719400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fix event_type for event-driven tasks (was NULL due to missing column in original INSERT)
    await queryRunner.query(`
      UPDATE automation_tasks
      SET event_type = 'book.returned'
      WHERE name = 'book_availability_notify' AND event_type IS NULL
    `);

    await queryRunner.query(`
      UPDATE automation_tasks
      SET event_type = 'schedule.changed'
      WHERE name = 'schedule_change_notify' AND event_type IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE automation_tasks SET event_type = NULL WHERE name IN ('book_availability_notify', 'schedule_change_notify')`);
  }
}
