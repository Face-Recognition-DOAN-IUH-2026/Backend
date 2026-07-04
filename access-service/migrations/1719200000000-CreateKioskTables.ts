import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKioskTables1719200000000 implements MigrationInterface {
  name = 'CreateKioskTables1719200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS access`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS access.kiosk_devices (
        id varchar(50) PRIMARY KEY,
        device_name varchar(100) NOT NULL DEFAULT '',
        ip_address varchar(45) NULL,
        mac_address varchar(17) NULL,
        location varchar(100) NULL,
        is_active boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS access.kiosk_approval_requests (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_code varchar(10) UNIQUE NOT NULL,
        kiosk_device_id varchar(50) NOT NULL REFERENCES access.kiosk_devices(id),
        patron_id uuid NULL,
        patron_student_code varchar(20) NULL,
        fail_image_url text NULL,
        isbns varchar(500) NULL,
        device_auth_token text NOT NULL,
        status varchar(20) DEFAULT 'pending',
        approved_by uuid NULL,
        approved_at timestamptz NULL,
        reject_reason text NULL,
        created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
        expires_at timestamptz NOT NULL
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_kiosk_approval_event_code ON access.kiosk_approval_requests(event_code)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_kiosk_approval_status ON access.kiosk_approval_requests(status)`);

    await queryRunner.query(`
      INSERT INTO access.kiosk_devices (id, device_name, is_active)
      VALUES ('kiosk-1', 'Kiosk 1', true)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS access.kiosk_approval_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS access.kiosk_devices`);
  }
}
