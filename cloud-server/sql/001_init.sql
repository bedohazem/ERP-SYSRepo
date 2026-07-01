CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  name TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_operations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  branch_id TEXT,
  type TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  error TEXT,
  client_created_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_operations_device
ON sync_operations(device_id);

CREATE INDEX IF NOT EXISTS idx_sync_operations_status
ON sync_operations(status, received_at);

CREATE INDEX IF NOT EXISTS idx_sync_operations_type
ON sync_operations(type);

CREATE TABLE IF NOT EXISTS server_events (
  version BIGSERIAL PRIMARY KEY,
  operation_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  branch_id TEXT,
  type TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_server_events_version
ON server_events(version);

CREATE INDEX IF NOT EXISTS idx_server_events_branch
ON server_events(branch_id, version);