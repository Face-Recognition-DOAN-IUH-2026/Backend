import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Book } from './Book';

@Entity({ name: 'book_reservations' })
export class BookReservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'patron_id', type: 'uuid' })
  patronId!: string;

  @Column({ name: 'book_id', type: 'uuid' })
  bookId!: string;

  @Column({ name: 'reserved_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  reservedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: string;

  @Column({ name: 'notified_at', type: 'timestamp', nullable: true })
  notifiedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @ManyToOne(() => Book)
  @JoinColumn({ name: 'book_id' })
  book!: Book;
}
