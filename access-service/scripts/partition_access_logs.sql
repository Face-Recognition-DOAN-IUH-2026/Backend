-- =============================================================================
-- Partition Access Logs by Month
-- =============================================================================
-- Prerequisites:
--   1. Run face-recognition-service/scripts/migration_v0.3.0.sql first
--   2. This script creates a new partitioned table and migrates existing data
-- =============================================================================

BEGIN;

-- Step 1: Create partitioned table (access_time must be in PK for range partition)
CREATE TABLE access_logs_new (
  id UUID NOT NULL,
  patron_id UUID,
  access_type VARCHAR(10) NOT NULL,
  verify_method VARCHAR(20) NOT NULL DEFAULT 'face',
  confidence FLOAT,
  camera_id VARCHAR(50) NOT NULL,
  image_url TEXT,
  access_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'success',
  event_id VARCHAR(80),
  source VARCHAR(50) NOT NULL DEFAULT 'access-service',
  PRIMARY KEY (id, access_time)
) PARTITION BY RANGE (access_time);

-- Step 2: Create monthly partitions for 2026
CREATE TABLE access_logs_2026_01 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE access_logs_2026_02 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE access_logs_2026_03 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE access_logs_2026_04 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE access_logs_2026_05 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE access_logs_2026_06 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE access_logs_2026_07 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE access_logs_2026_08 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE access_logs_2026_09 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE access_logs_2026_10 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE access_logs_2026_11 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE access_logs_2026_12 PARTITION OF access_logs_new
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Step 3: Future partition (catches data beyond current year)
CREATE TABLE access_logs_future PARTITION OF access_logs_new
  FOR VALUES FROM ('2027-01-01') TO ('9999-12-31');

-- Step 4: Indexes on each partition (for patron_id lookups)
CREATE INDEX idx_access_logs_patron_time ON access_logs_new (patron_id, access_time DESC);
CREATE INDEX idx_access_logs_type_time ON access_logs_new (access_type, access_time DESC)
  WHERE status = 'success';

-- Step 5: Migrate existing data from old table
INSERT INTO access_logs_new
SELECT id, patron_id, access_type, verify_method, confidence,
       camera_id, image_url, access_time, status, event_id, source
FROM access_logs
ON CONFLICT DO NOTHING;

-- Step 6: Swap tables (requires exclusive lock — schedule during maintenance)
-- ALTER TABLE access_logs RENAME TO access_logs_old;
-- ALTER TABLE access_logs_new RENAME TO access_logs;
-- DROP TABLE access_logs_old;

-- Step 7: Update TypeORM entity reference (deployment step)
-- UPDATE access_service: AccessLog entity table name → access_logs_new
-- Or use a VIEW to abstract the partition:
-- CREATE OR REPLACE VIEW access_logs AS SELECT * FROM access_logs_new;

COMMIT;
