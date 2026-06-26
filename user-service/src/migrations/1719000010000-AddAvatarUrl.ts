import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAvatarUrl1719000010000 implements MigrationInterface {
  name = 'AddAvatarUrl1719000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS avatar_url TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS avatar_url
    `);
  }
}