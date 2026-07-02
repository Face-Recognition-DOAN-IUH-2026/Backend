import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKioskApprovalRequests1720200000000 implements MigrationInterface {
  name = 'CreateKioskApprovalRequests1720200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS access.kiosk_approval_requests (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_code varchar(10) NOT NULL,
        kiosk_device_id uuid NOT NULL,
        patron_id uuid NULL,
        patron_student_code varchar(20) NULL,
        fail_image_url text NULL,
        isbns varchar(500) NULL,
        device_auth_token text NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending',
        approved_by uuid NULL,
        approved_at timestamptz NULL,
        reject_reason text NULL,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at timestamptz NOT NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_event_code ON access.kiosk_approval_requests(event_code)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_approval_status ON access.kiosk_approval_requests(status)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS access.kiosk_approval_requests`);
  }
}
