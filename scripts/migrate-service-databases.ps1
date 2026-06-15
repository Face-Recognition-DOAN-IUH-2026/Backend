param(
  [string]$Container = "backend-postgres-1",
  [string]$User = "postgres",
  [string]$Password = "postgres",
  [string]$SourceDb = "face_recognition"
)

$ErrorActionPreference = "Stop"
$SourceConn = "host=localhost port=5432 dbname=$SourceDb user=$User password=$Password"

function Invoke-Psql {
  param([string]$Database, [string]$Sql)
  $Sql | docker exec -i $Container psql -U $User -d $Database -v ON_ERROR_STOP=1
}

Write-Host "Ensuring service databases exist..."
Get-Content -Raw -Path "$PSScriptRoot/create-service-databases.sql" |
  docker exec -i $Container psql -U $User -d postgres -v ON_ERROR_STOP=1

Write-Host "Copying users to userdb..."
Invoke-Psql -Database "userdb" -Sql @"
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) UNIQUE NOT NULL,
  password_hash varchar(255) NOT NULL,
  full_name varchar(255),
  role varchar(50) DEFAULT 'user',
  student_code varchar(50) UNIQUE,
  class_name varchar(100),
  identity_number varchar(50),
  phone varchar(50),
  card_number varchar(50) UNIQUE,
  issue_date date,
  membership_expiry date,
  current_status varchar(10) DEFAULT 'outside',
  last_entry_at timestamp,
  last_entry_camera varchar(50),
  status varchar(20) DEFAULT 'active',
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
  password_auto_generated boolean NOT NULL DEFAULT true
);
INSERT INTO users (
  id, email, password_hash, full_name, role, student_code, class_name,
  identity_number, phone, card_number, issue_date, membership_expiry,
  current_status, last_entry_at, last_entry_camera, status, created_at,
  updated_at, password_auto_generated
)
SELECT *
FROM dblink('$SourceConn', '
  SELECT id, email, password_hash, full_name, role, student_code, class_name,
    identity_number, phone, card_number, issue_date, membership_expiry,
    current_status, last_entry_at, last_entry_camera, status, created_at,
    updated_at, COALESCE(password_auto_generated, true)
  FROM public.users
') AS t(
  id uuid, email varchar, password_hash varchar, full_name varchar, role varchar,
  student_code varchar, class_name varchar, identity_number varchar, phone varchar,
  card_number varchar, issue_date date, membership_expiry date, current_status varchar,
  last_entry_at timestamp, last_entry_camera varchar, status varchar,
  created_at timestamp, updated_at timestamp, password_auto_generated boolean
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  student_code = EXCLUDED.student_code,
  class_name = EXCLUDED.class_name,
  identity_number = EXCLUDED.identity_number,
  phone = EXCLUDED.phone,
  card_number = EXCLUDED.card_number,
  issue_date = EXCLUDED.issue_date,
  membership_expiry = EXCLUDED.membership_expiry,
  current_status = EXCLUDED.current_status,
  last_entry_at = EXCLUDED.last_entry_at,
  last_entry_camera = EXCLUDED.last_entry_camera,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at,
  password_auto_generated = EXCLUDED.password_auto_generated;
"@

Write-Host "Copying borrow tables to borrowdb..."
Invoke-Psql -Database "borrowdb" -Sql @"
CREATE EXTENSION IF NOT EXISTS `"uuid-ossp`";
CREATE EXTENSION IF NOT EXISTS dblink;
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
DO `$`$
BEGIN
  BEGIN
    INSERT INTO books
    SELECT * FROM dblink('$SourceConn', 'SELECT id, isbn, title, author, cover_url, is_available, shelf_location, created_at, updated_at FROM public.books')
    AS t(id uuid, isbn varchar, title varchar, author varchar, cover_url text, is_available boolean, shelf_location varchar, created_at timestamp, updated_at timestamp)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping legacy books copy: %', SQLERRM;
  END;
  BEGIN
    INSERT INTO book_copies
    SELECT * FROM dblink('$SourceConn', 'SELECT id, book_id, barcode, is_available, shelf_location, created_at, updated_at FROM public.book_copies')
    AS t(id uuid, book_id uuid, barcode varchar, is_available boolean, shelf_location varchar, created_at timestamp, updated_at timestamp)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping legacy book_copies copy: %', SQLERRM;
  END;
  BEGIN
    INSERT INTO borrow_records (
      id, patron_id, book_id, copy_id, borrow_at, return_at, due_at,
      shelf_location, status, returned_by_user_id, returned_by_email,
      return_method, created_at, updated_at
    )
    SELECT * FROM dblink('$SourceConn', 'SELECT id, patron_id, book_id, copy_id, borrow_at, return_at, due_at, shelf_location, status, returned_by_user_id, returned_by_email, return_method, created_at, updated_at FROM public.borrow_records')
    AS t(id uuid, patron_id uuid, book_id uuid, copy_id uuid, borrow_at timestamp, return_at timestamp, due_at timestamp, shelf_location varchar, status varchar, returned_by_user_id uuid, returned_by_email varchar, return_method varchar, created_at timestamp, updated_at timestamp)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping legacy borrow_records copy: %', SQLERRM;
  END;
END
`$`$;
"@

Write-Host "Copying access data to accessdb..."
Invoke-Psql -Database "accessdb" -Sql @"
CREATE EXTENSION IF NOT EXISTS `"uuid-ossp`";
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE SCHEMA IF NOT EXISTS access;
CREATE TABLE IF NOT EXISTS access.access_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patron_id uuid NULL,
  access_type varchar(10) NOT NULL,
  verify_method varchar(20) NOT NULL DEFAULT 'face',
  confidence double precision NULL,
  camera_id varchar(50) NOT NULL,
  image_url text NULL,
  status varchar(20) NOT NULL DEFAULT 'success',
  event_id varchar(80) NULL,
  source varchar(50) NOT NULL DEFAULT 'legacy-migration',
  access_time timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS access.patron_access_states (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patron_id uuid NOT NULL UNIQUE,
  current_status varchar(10) NOT NULL DEFAULT 'outside',
  last_entry_at timestamptz NULL,
  last_entry_camera varchar(50) NULL,
  last_exit_at timestamptz NULL,
  last_exit_camera varchar(50) NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO `$`$
BEGIN
  BEGIN
    INSERT INTO access.access_logs (
      id, patron_id, access_type, verify_method, confidence, camera_id,
      image_url, status, source, access_time
    )
    SELECT id, patron_id, access_type, verify_method, confidence, camera_id,
      image_url, status, 'legacy-face-service', access_time
    FROM dblink('$SourceConn', 'SELECT id, patron_id, access_type, verify_method, confidence, camera_id, image_url, status, access_time FROM public.access_logs')
    AS t(id uuid, patron_id uuid, access_type varchar, verify_method varchar, confidence double precision, camera_id varchar, image_url text, status varchar, access_time timestamptz)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping legacy access_logs copy: %', SQLERRM;
  END;
  BEGIN
    INSERT INTO access.patron_access_states (
      patron_id, current_status, last_entry_at, last_entry_camera, updated_at
    )
    SELECT id, COALESCE(NULLIF(current_status, ''), 'outside'), last_entry_at,
      last_entry_camera, CURRENT_TIMESTAMP
    FROM dblink('$SourceConn', 'SELECT id, current_status, last_entry_at, last_entry_camera FROM public.users WHERE role = ''patron''')
    AS t(id uuid, current_status varchar, last_entry_at timestamptz, last_entry_camera varchar)
    ON CONFLICT (patron_id) DO UPDATE SET
      current_status = EXCLUDED.current_status,
      last_entry_at = EXCLUDED.last_entry_at,
      last_entry_camera = EXCLUDED.last_entry_camera,
      updated_at = CURRENT_TIMESTAMP;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping legacy access state copy: %', SQLERRM;
  END;
END
`$`$;
"@

Write-Host "Copying face enrollment metadata to facedb..."
Invoke-Psql -Database "facedb" -Sql @"
CREATE EXTENSION IF NOT EXISTS `"uuid-ossp`";
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE TABLE IF NOT EXISTS patron_faces (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patron_id uuid NOT NULL,
  angle varchar(20) NOT NULL DEFAULT 'frontal',
  milvus_id varchar(100),
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);
DO `$`$
BEGIN
  BEGIN
    INSERT INTO patron_faces (
      id, patron_id, angle, milvus_id, image_url, is_active, created_at, updated_at
    )
    SELECT id, patron_id, angle, milvus_id, image_url, is_active, created_at, updated_at
    FROM dblink('$SourceConn', 'SELECT id, patron_id, angle, milvus_id, image_url, is_active, created_at, updated_at FROM public.patron_faces')
    AS t(id uuid, patron_id uuid, angle varchar, milvus_id varchar, image_url text, is_active boolean, created_at timestamp, updated_at timestamp)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping legacy patron_faces copy: %', SQLERRM;
  END;
END
`$`$;
"@

Write-Host "Service database migration completed."
