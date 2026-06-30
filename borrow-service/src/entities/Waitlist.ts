import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Book } from './Book';

@Entity({ name: 'waitlists' })
export class Waitlist {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'book_id', type: 'uuid' })
  bookId!: string;

  @Column({ name: 'patron_id', type: 'uuid' })
  patronId!: string;

  @Column({ type: 'varchar', length: 20, default: 'waiting' })
  status!: string;

  @Column({ name: 'notified_at', type: 'timestamptz', nullable: true })
  notifiedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @ManyToOne(() => Book, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book?: Book;
}
