import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateStaffShiftPreference1740100000002 implements MigrationInterface {
  name = 'CreateStaffShiftPreference1740100000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
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
      }),
      true
    );

    await queryRunner.createForeignKey(
      'schedule.staff_shift_preferences',
      new TableForeignKey({
        name: 'fk_pref_staff',
        columnNames: ['staff_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
      })
    );

    await queryRunner.createForeignKey(
      'schedule.staff_shift_preferences',
      new TableForeignKey({
        name: 'fk_pref_shift',
        columnNames: ['shift_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'staff_shifts',
      })
    );

    await queryRunner.createForeignKey(
      'schedule.staff_shift_preferences',
      new TableForeignKey({
        name: 'fk_pref_zone',
        columnNames: ['zone_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'library_zones',
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('schedule.staff_shift_preferences', true);
  }
}