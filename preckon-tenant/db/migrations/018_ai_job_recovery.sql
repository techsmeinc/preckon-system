-- 018 — make ai_job a durable queue rather than a record of what was attempted.
--
-- The table already anticipated retries: `attempt`, `max_attempts`, an
-- idempotency key, a status enum with 'queued' and 'running'. Nothing used them.
-- Dispatch was:
--
--   INSERT ai_job (queued) → UPDATE workflow_run_step → HTTP POST worker
--
-- and if that POST threw — worker restarting, container rescheduled, a blip —
-- enqueueJob threw with the row already written. The job sat 'queued' forever,
-- the run step waited on a callback that would never come, and nothing looked
-- for it. One worker restart could strand every job in flight.
--
-- ── WHY NO BROKER ────────────────────────────────────────────────────────────
--
-- Redis/SQS/Rabbit would all work, and none is available on an on-prem install
-- that ships as one compose file. The row IS the queue: MySQL is already the
-- durability boundary for everything else here, a claim is one conditional
-- UPDATE, and the reconciler is a query. The dispatcher stays an interface, so a
-- broker can be slotted underneath later without changing callers.
--
-- ── THE MISSING DISTINCTION ──────────────────────────────────────────────────
--
-- Nothing ever wrote status='running'. Jobs went queued → succeeded/failed, so a
-- job the worker was actively processing and a job that was never dispatched
-- looked identical, and no recovery rule could tell them apart without either
-- re-running live work or ignoring stuck work. Dispatch now claims the row into
-- 'running' with a lease, which makes the two distinguishable:
--
--   queued  + due            → never dispatched, or dispatch failed → send it
--   running + lease expired  → worker took it and never called back → retry
--
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS and every migration re-runs on deploy,
-- so each add is guarded on information_schema.

SET @db := DATABASE();

-- When the envelope was last handed to a worker. Distinct from queued_at (when
-- the work was requested) and from started_at (when the worker began), so a slow
-- worker and a lost dispatch are not the same reading.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE ai_job ADD COLUMN dispatched_at DATETIME(3) NULL AFTER queued_at',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_job' AND COLUMN_NAME = 'dispatched_at');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Not before this. Backoff after a failed dispatch, so a worker that is down
-- does not get hammered by a reconciler every few seconds. NULL means eligible
-- immediately, which is what a freshly queued job wants.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE ai_job ADD COLUMN next_attempt_at DATETIME(3) NULL AFTER dispatched_at',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_job' AND COLUMN_NAME = 'next_attempt_at');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- How long we assume a dispatched job is still being worked on. Past this with
-- no callback, it is treated as lost. Long enough to cover the slowest real job
-- (a BOQ roster with a vision pass), because reclaiming a job that is merely
-- slow means running it twice.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE ai_job ADD COLUMN lease_until DATETIME(3) NULL AFTER next_attempt_at',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_job' AND COLUMN_NAME = 'lease_until');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Why it was retried, for the last attempt. A job that eventually succeeded
-- after two lost dispatches should be able to say so.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE ai_job ADD COLUMN last_error VARCHAR(500) NULL AFTER lease_until',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_job' AND COLUMN_NAME = 'last_error');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The reconciler's scan: "what is due, oldest first". Without this it is a table
-- scan every few seconds over a table that only grows.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX ai_job_due_idx ON ai_job (status, next_attempt_at)',
  'SELECT 1') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_job' AND INDEX_NAME = 'ai_job_due_idx');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Expired-lease scan.
SET @sql := (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX ai_job_lease_idx ON ai_job (status, lease_until)',
  'SELECT 1') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_job' AND INDEX_NAME = 'ai_job_lease_idx');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
