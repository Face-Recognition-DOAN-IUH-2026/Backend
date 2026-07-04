CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS access;

CREATE TABLE IF NOT EXISTS access.kiosk_devices (
  id varchar(50) PRIMARY KEY,
  device_name varchar(100) NOT NULL DEFAULT '',
  ip_address varchar(45) NULL,
  mac_address varchar(17) NULL,
  location varchar(100) NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  source varchar(50) NOT NULL DEFAULT 'access-service',
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

CREATE INDEX IF NOT EXISTS idx_access_logs_time ON access.access_logs(access_time DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_patron ON access.access_logs(patron_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_camera ON access.access_logs(camera_id);
CREATE INDEX IF NOT EXISTS idx_patron_access_states_status ON access.patron_access_states(current_status);

INSERT INTO access.kiosk_devices (id, device_name, is_active)
VALUES ('kiosk-1', 'Kiosk 1', true)
ON CONFLICT (id) DO NOTHING;