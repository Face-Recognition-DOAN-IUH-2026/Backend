import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPatronColumns1718000000001 implements MigrationInterface {
  name = 'AddPatronColumns1718000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS student_code VARCHAR(50) UNIQUE,
        ADD COLUMN IF NOT EXISTS class_name VARCHAR(100),
        ADD COLUMN IF NOT EXISTS identity_number VARCHAR(50),
        ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
        ADD COLUMN IF NOT EXISTS card_number VARCHAR(50) UNIQUE,
        ADD COLUMN IF NOT EXISTS issue_date DATE,
        ADD COLUMN IF NOT EXISTS membership_expiry DATE,
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS current_status VARCHAR(10) NOT NULL DEFAULT 'outside',
        ADD COLUMN IF NOT EXISTS last_entry_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS last_entry_camera VARCHAR(50);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users 
        DROP COLUMN IF EXISTS student_code,
        DROP COLUMN IF EXISTS class_name,
        DROP COLUMN IF EXISTS identity_number,
        DROP COLUMN IF EXISTS phone,
        DROP COLUMN IF EXISTS card_number,
        DROP COLUMN IF EXISTS issue_date,
        DROP COLUMN IF EXISTS membership_expiry,
        DROP COLUMN IF EXISTS status,
        DROP COLUMN IF EXISTS current_status,
        DROP COLUMN IF EXISTS last_entry_at,
        DROP COLUMN IF EXISTS last_entry_camera;
    `);
  }
}
