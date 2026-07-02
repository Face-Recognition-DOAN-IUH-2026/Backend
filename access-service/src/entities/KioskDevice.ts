import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { config } from '../config';

@Entity({ schema: config.db.schema, name: 'kiosk_devices' })
export class KioskDevice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'device_name', type: 'varchar', length: 100 })
  deviceName!: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 45 })
  ipAddress!: string;

  @Column({ name: 'mac_address', type: 'varchar', length: 17, nullable: true })
  macAddress!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  location!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
