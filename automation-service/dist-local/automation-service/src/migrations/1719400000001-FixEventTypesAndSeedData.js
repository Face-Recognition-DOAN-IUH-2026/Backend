"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FixEventTypesAndSeedData1719400000001 = void 0;
class FixEventTypesAndSeedData1719400000001 {
    constructor() {
        this.name = 'FixEventTypesAndSeedData1719400000001';
    }
    async up(queryRunner) {
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
    async down(queryRunner) {
        await queryRunner.query(`UPDATE automation_tasks SET event_type = NULL WHERE name IN ('book_availability_notify', 'schedule_change_notify')`);
    }
}
exports.FixEventTypesAndSeedData1719400000001 = FixEventTypesAndSeedData1719400000001;
