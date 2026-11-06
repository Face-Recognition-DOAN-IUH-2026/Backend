import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BookCopy } from './BookCopy';
import { MIGRATION_MANAGED_INDEX } from './migrationManagedIndex';

@Index(['shelfLocation'])
@Index(['isAvailable'])
// Trigram GIN indexes are created by migration 1770800000000-AddPgTrgmSearchIndexes.
@Index('idx_books_title_trgm', ['title'], MIGRATION_MANAGED_INDEX)
@Index('idx_books_isbn_trgm', ['isbn'], MIGRATION_MANAGED_INDEX)
@Index('idx_books_author_trgm', ['author'], MIGRATION_MANAGED_INDEX)
@Entity({ name: 'books' })
export class Book {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  isbn!: string;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  subtitle!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  author!: string | null;

  @Column({ name: 'cover_url', type: 'text', nullable: true })
  coverUrl!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  publisher!: string | null;

  @Column({ name: 'published_date', type: 'varchar', length: 20, nullable: true })
  publishedDate!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'page_count', type: 'int', nullable: true })
  pageCount!: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  categories!: string | null;

  @Column({ name: 'average_rating', type: 'decimal', precision: 3, scale: 1, nullable: true })
  averageRating!: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  language!: string | null;

  @Column({ name: 'isbn10', type: 'varchar', length: 10, nullable: true })
  isbn10!: string | null;

  @Column({ name: 'isbn13', type: 'varchar', length: 13, nullable: true })
  isbn13!: string | null;

  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable!: boolean;

  @Column({ name: 'shelf_location', type: 'varchar', length: 100, nullable: true })
  shelfLocation!: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  price!: number | null;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;

  @OneToMany(() => BookCopy, (copy) => copy.book)
  copies!: BookCopy[];
}
