import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationsTable1719300000000 implements MigrationInterface {
  name = 'CreateNotificationsTable1719300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id uuid NOT NULL,
        type varchar(50) NOT NULL,
        title varchar(255) NOT NULL,
        body text NOT NULL,
        data jsonb,
        is_read boolean DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        read_at timestamptz
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications(user_id, created_at DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notifications`);
  }
}
