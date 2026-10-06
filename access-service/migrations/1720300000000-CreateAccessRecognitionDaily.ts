import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccessRecognitionDaily1720300000000 implements MigrationInterface {
  name = 'CreateAccessRecognitionDaily1720300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS access`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS access.access_recognition_daily (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        stat_date date NOT NULL,
        camera_id varchar(50) NOT NULL,
        granted int NOT NULL DEFAULT 0,
        spoof int NOT NULL DEFAULT 0,
        no_match int NOT NULL DEFAULT 0,
        other int NOT NULL DEFAULT 0,
        avg_confidence double precision NULL,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_access_recognition_daily_date_camera UNIQUE (stat_date, camera_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_access_recognition_daily_date ON access.access_recognition_daily(stat_date)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_access_recognition_daily_camera ON access.access_recognition_daily(camera_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS access.access_recognition_daily`);
  }
}
