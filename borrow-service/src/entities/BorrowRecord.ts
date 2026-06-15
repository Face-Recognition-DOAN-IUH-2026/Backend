import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Book } from './Book';
import { BookCopy } from './BookCopy';

@Entity({ name: 'borrow_records' })
export class BorrowRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'patron_id', type: 'uuid' })
  patronId!: string;

  @Column({ name: 'book_id', type: 'uuid' })
  bookId!: string;

  @Column({ name: 'copy_id', type: 'uuid', nullable: true })
  copyId!: string | null;

  @Column({ name: 'borrow_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  borrowAt!: Date;

  @Column({ name: 'return_at', type: 'timestamp', nullable: true })
  returnAt!: Date | null;

  @Column({ name: 'due_at', type: 'timestamp' })
  dueAt!: Date;

  @Column({ name: 'shelf_location', type: 'varchar', length: 100, nullable: true })
  shelfLocation!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'borrowed' })
  status!: string;

  @Column({ name: 'returned_by_user_id', type: 'uuid', nullable: true })
  returnedByUserId!: string | null;

  @Column({ name: 'returned_by_email', type: 'varchar', length: 255, nullable: true })
  returnedByEmail!: string | null;

  @Column({ name: 'return_method', type: 'varchar', length: 50, nullable: true })
  returnMethod!: string | null;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;

  @ManyToOne(() => Book)
  @JoinColumn({ name: 'book_id' })
  book!: Book;

  @ManyToOne(() => BookCopy, { nullable: true })
  @JoinColumn({ name: 'copy_id' })
  copy!: BookCopy | null;
}
