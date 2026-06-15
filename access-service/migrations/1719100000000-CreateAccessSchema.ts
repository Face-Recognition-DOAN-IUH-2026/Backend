import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccessSchema1719100000000 implements MigrationInterface {
  name = 'CreateAccessSchema1719100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS access`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS access.access_logs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        patron_id uuid NULL,
        access_type varchar(10) NOT NULL,
        verify_method varchar(20) NOT NULL DEFAULT 'face',
        confidence double precision NULL,
        camera_id varchar(50) NOT NULL,
        image_url text NULL,
        status varchar(20) NOT NULL DEFAULT 'success',
        event_id varchar(80) NULL,
        source varchar(50) NOT NULL DEFAULT 'access-service',
        access_time timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS access.patron_access_states (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        patron_id uuid NOT NULL UNIQUE,
        current_status varchar(10) NOT NULL DEFAULT 'outside',
        last_entry_at timestamptz NULL,
        last_entry_camera varchar(50) NULL,
        last_exit_at timestamptz NULL,
        last_exit_camera varchar(50) NULL,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_access_logs_time ON access.access_logs(access_time DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_access_logs_patron ON access.access_logs(patron_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_access_logs_camera ON access.access_logs(camera_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_patron_access_states_status ON access.patron_access_states(current_status)`);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.access_logs') IS NOT NULL THEN
          INSERT INTO access.access_logs (
            id, patron_id, access_type, verify_method, confidence, camera_id,
            image_url, status, source, access_time
          )
          SELECT
            id, patron_id, access_type, verify_method, confidence, camera_id,
            image_url, status, 'legacy-face-service', access_time
          FROM public.access_logs
          ON CONFLICT (id) DO NOTHING;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.users') IS NOT NULL THEN
          INSERT INTO access.patron_access_states (
            patron_id, current_status, last_entry_at, last_entry_camera, updated_at
          )
          SELECT
            id,
            COALESCE(NULLIF(current_status, ''), 'outside'),
            last_entry_at,
            last_entry_camera,
            CURRENT_TIMESTAMP
          FROM public.users
          WHERE role = 'patron'
          ON CONFLICT (patron_id) DO UPDATE SET
            current_status = EXCLUDED.current_status,
            last_entry_at = EXCLUDED.last_entry_at,
            last_entry_camera = EXCLUDED.last_entry_camera,
            updated_at = CURRENT_TIMESTAMP;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS access.patron_access_states`);
    await queryRunner.query(`DROP TABLE IF EXISTS access.access_logs`);
  }
}
