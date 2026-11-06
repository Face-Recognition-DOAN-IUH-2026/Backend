import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'geofence_configs', schema: 'schedule' })
export class GeofenceConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'zone_id', unique: true, nullable: true })
  zoneId: string | null;

  @Column({ type: 'boolean', default: false, name: 'is_global' })
  isGlobal: boolean;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  @Column({ type: 'int', name: 'radius_meters', default: 100 })
  radiusMeters: number;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'text', nullable: true, name: 'address_hint' })
  addressHint: string | null;

  @Column({ type: 'text', array: true, nullable: true, name: 'allowed_wifi_ssids' })
  allowedWifiSsids: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
