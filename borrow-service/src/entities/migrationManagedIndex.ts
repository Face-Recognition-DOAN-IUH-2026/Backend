import type { IndexOptions } from 'typeorm';

/**
 * Options for indexes that are owned by database migrations instead of TypeORM's
 * `synchronize`.
 *
 * `synchronize: false` keeps the index registered in entity metadata (so schema sync
 * does not drop it) while preventing TypeORM from trying to create it as a plain
 * B-Tree index. TypeORM's `IndexOptions` type omits `synchronize` even though the
 * decorator runtime honours it, hence the cast.
 */
export const MIGRATION_MANAGED_INDEX = { synchronize: false } as IndexOptions;
