-- Migration 0005: Add cron expression to checks, add last_started_at to checks
-- Cron expression: stores the original crontab expression for display
-- last_started_at: tracks when a job sent a /start signal

ALTER TABLE checks ADD COLUMN cron_expression TEXT DEFAULT '';
ALTER TABLE checks ADD COLUMN last_started_at INTEGER;
