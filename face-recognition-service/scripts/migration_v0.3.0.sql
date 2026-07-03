-- =============================================================================
-- Migration v0.3.0: Add current_status tracking + access_logs partitioning
-- =============================================================================

-- Step 1: Add current_status columns to patrons table
ALTER TABLE patrons
  ADD COLUMN IF NOT EXISTS current_status VARCHAR(10) NOT NULL DEFAULT 'outside',
  ADD COLUMN IF NOT EXISTS last_entry_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_entry_camera VARCHAR(50);

-- Create index for fast active-patron queries
CREATE INDEX IF NOT EXISTS idx_patrons_current_status ON patrons (current_status, status)
  WHERE current_status = 'inside' AND status = 'active';

-- Step 2: Backfill current_status for patrons currently inside
-- This is a one-time reconciliation based on access_logs
UPDATE patrons p
SET current_status = 'inside',
    last_entry_at = sub.latest_entry,
    last_entry_camera = sub.entry_camera
FROM (
    SELECT
        al.patron_id,
        MAX(al.access_time) AS latest_entry,
        (SELECT al2.camera_id FROM access_logs al2
         WHERE al2.patron_id = al.patron_id
           AND al2.access_type = 'entry'
           AND al2.status = 'success'
         ORDER BY al2.access_time DESC LIMIT 1) AS entry_camera
    FROM access_logs al
    WHERE al.access_type = 'entry'
      AND al.status = 'success'
      AND al.access_time > NOW() - INTERVAL '24 hours'
    GROUP BY al.patron_id
    HAVING MAX(al.access_time) > COALESCE(
        (SELECT MAX(al3.access_time) FROM access_logs al3
         WHERE al3.patron_id = al.patron_id
           AND al3.access_type = 'exit'
           AND al3.status = 'success'),
        '1970-01-01'
    )
) sub
WHERE p.id = sub.patron_id;

-- Step 3: Create partitioned access_logs table
-- See access-service/scripts/partition_access_logs.sql for the full migration
-- This script creates the partitioned table and migrates existing data
\i '../../../access-service/scripts/partition_access_logs.sql'

-- Option B: Auto-create partitions monthly via pg_partman
-- CREATE EXTENSION IF NOT EXISTS pg_partman;
-- SELECT partman.create_parent(
--   p_parent_table := 'public.access_logs',
--   p_control := 'access_time',
--   p_type := 'native',
--   p_interval := '1 month',
--   p_premake := 3
-- );

-- Step 4: Add index for time-range queries (useful even without partitioning)
CREATE INDEX IF NOT EXISTS idx_access_logs_access_time ON access_logs (access_time DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_type_time ON access_logs (access_type, access_time DESC)
  WHERE status = 'success';
