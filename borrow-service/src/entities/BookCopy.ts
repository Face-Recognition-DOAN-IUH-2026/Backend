import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Book } from './Book';

@Index(['bookId', 'isAvailable'])
@Entity({ name: 'book_copies' })
export class BookCopy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'book_id', type: 'uuid' })
  bookId!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  barcode!: string;

  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable!: boolean;

  @Column({ name: 'shelf_location', type: 'varchar', length: 100, nullable: true })
  shelfLocation!: string | null;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;

  @ManyToOne(() => Book, (book) => book.copies)
  @JoinColumn({ name: 'book_id' })
  book!: Book;
}
