import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  STAFF = 'staff',
  PATRON = 'patron',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'full_name' })
  fullName: string | null;

  @Column({ type: 'varchar', length: 50, default: 'user' })
  role: string;

  @Column({ type: 'varchar', length: 50, unique: true, nullable: true, name: 'student_code' })
  studentCode: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'class_name' })
  className: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'identity_number' })
  identityNumber: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 50, unique: true, nullable: true, name: 'card_number' })
  cardNumber: string | null;

  @Column({ type: 'date', nullable: true, name: 'issue_date' })
  issueDate: string | null;

  @Column({ type: 'date', nullable: true, name: 'membership_expiry' })
  membershipExpiry: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: string;

  @Column({ type: 'varchar', length: 10, default: 'outside', name: 'current_status' })
  currentStatus: string;

  @Column({ type: 'timestamp', nullable: true, name: 'last_entry_at' })
  lastEntryAt: Date | null;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'last_entry_camera' })
  lastEntryCamera: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
