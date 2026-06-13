-- Create borrowdb database (runs only on first startup if data volume is empty)
-- This script is mounted to /docker-entrypoint-initdb.d/02-borrowdb.sql

SELECT 'Creating borrowdb database' AS status;
SELECT 'CREATE DATABASE borrowdb' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'borrowdb')\gexec