"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateStaffShiftPreference1740100000002 = void 0;
const typeorm_1 = require("typeorm");
class CreateStaffShiftPreference1740100000002 {
    constructor() {
        this.name = 'CreateStaffShiftPreference1740100000002';
    }
    async up(queryRunner) {
        await queryRunner.createTable(new typeorm_1.Table({
            name: 'staff_shift_preferences',
            schema: 'schedule',
            columns: [
                { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
                { name: 'staff_id', type: 'uuid' },
                { name: 'shift_id', type: 'uuid' },
                { name: 'zone_id', type: 'uuid' },
                { name: 'priority', type: 'int', default: 1 },
                { name: 'is_active', type: 'boolean', default: true },
                { name: 'created_at', type: 'timestamp', default: 'now()' },
                { name: 'updated_at', type: 'timestamp', default: 'now()' },
            ],
        }), true);
        await queryRunner.createForeignKey('schedule.staff_shift_preferences', new typeorm_1.TableForeignKey({
            name: 'fk_pref_staff',
            columnNames: ['staff_id'],
            referencedColumnNames: ['id'],
            referencedTableName: 'users',
        }));
        await queryRunner.createForeignKey('schedule.staff_shift_preferences', new typeorm_1.TableForeignKey({
            name: 'fk_pref_shift',
            columnNames: ['shift_id'],
            referencedColumnNames: ['id'],
            referencedTableName: 'staff_shifts',
        }));
        await queryRunner.createForeignKey('schedule.staff_shift_preferences', new typeorm_1.TableForeignKey({
            name: 'fk_pref_zone',
            columnNames: ['zone_id'],
            referencedColumnNames: ['id'],
            referencedTableName: 'library_zones',
        }));
    }
    async down(queryRunner) {
        await queryRunner.dropTable('schedule.staff_shift_preferences', true);
    }
}
exports.CreateStaffShiftPreference1740100000002 = CreateStaffShiftPreference1740100000002;
