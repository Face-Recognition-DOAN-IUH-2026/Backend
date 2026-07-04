import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenPatronAccessStatusForPending1720250000000 implements MigrationInterface {
  name = 'WidenPatronAccessStatusForPending1720250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE access.patron_access_states
      ALTER COLUMN current_status TYPE varchar(20)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE access.patron_access_states
      SET current_status = 'outside'
      WHERE current_status NOT IN ('inside', 'outside')
    `);
    await queryRunner.query(`
      ALTER TABLE access.patron_access_states
      ALTER COLUMN current_status TYPE varchar(10)
    `);
  }
}
