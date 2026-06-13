-- ============================================================================
-- Migration: Merge patrons into users table
-- Apply BEFORE deploying Phase 2 (face-service changes)
-- ============================================================================
-- 
-- How to run:
--   psql -h localhost -U postgres -d face_recognition -f migration_merge_patrons_to_users.sql
-- 
-- Verify before committing:
--   1. SELECT COUNT(*) FROM users WHERE role = 'patron';
--      Should equal: SELECT COUNT(*) FROM patrons;
--   2. SELECT COUNT(*) FROM patron_faces pf
--      JOIN users u ON u.id = pf.patron_id;
--      Should equal: SELECT COUNT(*) FROM patron_faces;
-- ============================================================================

BEGIN;

-- Step 1: Backfill user-service existing users with patron columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS student_code VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS class_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS identity_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS card_number VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS issue_date DATE,
  ADD COLUMN IF NOT EXISTS membership_expiry DATE,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS current_status VARCHAR(10) NOT NULL DEFAULT 'outside',
  ADD COLUMN IF NOT EXISTS last_entry_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_entry_camera VARCHAR(50);

-- Step 2: Copy patrons data into users
INSERT INTO users (
  id, email, password_hash, full_name, role,
  student_code, class_name, identity_number, phone, card_number,
  issue_date, membership_expiry, status, current_status,
  last_entry_at, last_entry_camera, created_at, updated_at
)
SELECT
  p.id,
  COALESCE(p.email, p.student_code || '@library.local'),
  COALESCE(p.password_hash, '$2a$10$placeholder_hash_not_usable'),
  p.full_name,
  'patron',
  p.student_code,
  p.class_name,
  p.identity_number,
  p.phone,
  p.card_number,
  p.issue_date,
  p.membership_expiry,
  p.status,
  p.current_status,
  p.last_entry_at,
  p.last_entry_camera,
  p.created_at,
  p.updated_at
FROM patrons p
ON CONFLICT (id) DO NOTHING;

-- Step 3: Update patron_faces FK to reference users.id
ALTER TABLE patron_faces DROP CONSTRAINT IF EXISTS patron_faces_patron_id_fkey;
ALTER TABLE patron_faces
  ADD CONSTRAINT patron_faces_patron_id_fkey
  FOREIGN KEY (patron_id) REFERENCES users(id);

-- Step 4: Update access_logs FK to reference users.id
ALTER TABLE access_logs DROP CONSTRAINT IF EXISTS access_logs_patron_id_fkey;
ALTER TABLE access_logs
  ADD CONSTRAINT access_logs_patron_id_fkey
  FOREIGN KEY (patron_id) REFERENCES users(id);

-- Step 5: Drop patrons table
DROP TABLE IF EXISTS patrons CASCADE;

-- Step 6: Create indexes for patron queries
CREATE INDEX IF NOT EXISTS idx_users_student_code ON users (student_code) WHERE student_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_card_number ON users (card_number) WHERE card_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users (role, status);
CREATE INDEX IF NOT EXISTS idx_users_active_inside ON users (role, current_status, status)
  WHERE role = 'patron' AND current_status = 'inside' AND status = 'active';

COMMIT;

-- ============================================================================
-- Verification queries (run after commit):
-- ============================================================================
-- SELECT 'patron_faces count' AS check_name, COUNT(*) FROM patron_faces
-- UNION ALL
-- SELECT 'users with role=patron count', COUNT(*) FROM users WHERE role = 'patron'
-- UNION ALL
-- SELECT 'patron_faces with valid FK', COUNT(*) FROM patron_faces pf
--   JOIN users u ON u.id = pf.patron_id
-- UNION ALL
-- SELECT 'access_logs count', COUNT(*) FROM access_logs
-- UNION ALL
-- SELECT 'access_logs with valid FK', COUNT(*) FROM access_logs al
--   JOIN users u ON u.id = al.patron_id;
