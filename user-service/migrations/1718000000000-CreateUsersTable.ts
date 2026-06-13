import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateUsersTable1718000000000 implements MigrationInterface {
  name = 'CreateUsersTable1718000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'email', type: 'varchar', length: '255', isUnique: true },
          { name: 'password_hash', type: 'varchar', length: '255' },
          { name: 'full_name', type: 'varchar', length: '255', isNullable: true },
          { name: 'role', type: 'varchar', length: '50', default: "'user'" },
          { name: 'student_code', type: 'varchar', length: '50', isUnique: true, isNullable: true },
          { name: 'class_name', type: 'varchar', length: '100', isNullable: true },
          { name: 'identity_number', type: 'varchar', length: '50', isNullable: true },
          { name: 'phone', type: 'varchar', length: '50', isNullable: true },
          { name: 'card_number', type: 'varchar', length: '50', isUnique: true, isNullable: true },
          { name: 'issue_date', type: 'date', isNullable: true },
          { name: 'membership_expiry', type: 'date', isNullable: true },
          { name: 'current_status', type: 'varchar', length: '10', default: "'outside'" },
          { name: 'last_entry_at', type: 'timestamp', isNullable: true },
          { name: 'last_entry_camera', type: 'varchar', length: '50', isNullable: true },
          { name: 'status', type: 'varchar', length: '20', default: "'active'" },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('users');
  }
}
