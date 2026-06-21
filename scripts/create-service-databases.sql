-- Creates logical databases for the local microservice topology.
-- This script is safe to run more than once and is used by docker-entrypoint
-- only on a fresh Postgres volume.

SELECT 'CREATE DATABASE userdb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'userdb')\gexec

SELECT 'CREATE DATABASE borrowdb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'borrowdb')\gexec

SELECT 'CREATE DATABASE accessdb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'accessdb')\gexec

SELECT 'CREATE DATABASE scheduledb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'scheduledb')\gexec

SELECT 'CREATE DATABASE facedb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'facedb')\gexec

SELECT 'CREATE DATABASE aidb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aidb')\gexec

SELECT 'CREATE DATABASE notificationdb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'notificationdb')\gexec

SELECT 'CREATE DATABASE automationdb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'automationdb')\gexec

\connect borrowdb

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS books (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  isbn varchar(20) UNIQUE NOT NULL,
  title varchar(500) NOT NULL,
  author varchar(255),
  cover_url text,
  is_available boolean DEFAULT true,
  shelf_location varchar(100),
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS book_copies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  barcode varchar(50) UNIQUE NOT NULL,
  is_available boolean DEFAULT true,
  shelf_location varchar(100),
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS borrow_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patron_id uuid NOT NULL,
  book_id uuid NOT NULL REFERENCES books(id),
  copy_id uuid REFERENCES book_copies(id),
  borrow_at timestamp DEFAULT CURRENT_TIMESTAMP,
  return_at timestamp,
  due_at timestamp NOT NULL,
  shelf_location varchar(100),
  status varchar(20) DEFAULT 'borrowed',
  returned_by_user_id uuid,
  returned_by_email varchar(255),
  return_method varchar(50),
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_borrow_records_patron_status ON borrow_records(patron_id, status);
CREATE INDEX IF NOT EXISTS idx_borrow_records_copy_status ON borrow_records(copy_id, status);
CREATE INDEX IF NOT EXISTS idx_book_copies_book_available ON book_copies(book_id, is_available);
