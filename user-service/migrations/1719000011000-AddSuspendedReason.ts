import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSuspendedReason1719000011000 implements MigrationInterface {
  name = 'AddSuspendedReason1719000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS suspended_reason TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS suspended_reason
    `);
  }
}
