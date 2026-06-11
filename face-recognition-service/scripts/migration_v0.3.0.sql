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

-- Step 3: Create partitioned access_logs table (for new deployments)
-- For existing deployments, use pg_partman or manual partitioning

-- Option A: Using PostgreSQL native partitioning (requires new table)
-- CREATE TABLE access_logs_new (
--   id UUID NOT NULL,
--   patron_id UUID,
--   access_type VARCHAR(10) NOT NULL,
--   verify_method VARCHAR(20) NOT NULL,
--   confidence FLOAT,
--   camera_id VARCHAR(50) NOT NULL,
--   image_url TEXT,
--   access_time TIMESTAMP NOT NULL DEFAULT NOW(),
--   status VARCHAR(20) NOT NULL,
--   PRIMARY KEY (id, access_time)
-- ) PARTITION BY RANGE (access_time);

-- CREATE TABLE access_logs_2026_01 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- CREATE TABLE access_logs_2026_02 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- CREATE TABLE access_logs_2026_03 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
-- CREATE TABLE access_logs_2026_04 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
-- CREATE TABLE access_logs_2026_05 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
-- CREATE TABLE access_logs_2026_06 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
-- CREATE TABLE access_logs_2026_07 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
-- CREATE TABLE access_logs_2026_08 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
-- CREATE TABLE access_logs_2026_09 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
-- CREATE TABLE access_logs_2026_10 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
-- CREATE TABLE access_logs_2026_11 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
-- CREATE TABLE access_logs_2026_12 PARTITION OF access_logs_new
--   FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
-- CREATE TABLE access_logs_future PARTITION OF access_logs_new
--   FOR VALUES FROM ('2027-01-01') TO ('9999-12-31');

-- Create local indexes on each partition
-- CREATE INDEX idx_access_logs_patron_id ON access_logs_new (patron_id, access_time DESC);

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
