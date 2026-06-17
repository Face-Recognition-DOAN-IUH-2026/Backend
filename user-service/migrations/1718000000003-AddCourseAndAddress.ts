import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCourseAndAddress1718000000003 implements MigrationInterface {
  name = 'AddCourseAndAddress1718000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS course VARCHAR(50),
        ADD COLUMN IF NOT EXISTS permanent_address TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS course,
        DROP COLUMN IF EXISTS permanent_address
    `);
  }
}
