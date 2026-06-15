import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'library_zones', schema: 'schedule' })
export class LibraryZone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  floor: number;

  @Column({ type: 'varchar', length: 100, name: 'zone_name' })
  zoneName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
