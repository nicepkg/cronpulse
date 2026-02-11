-- Migration 0004: Add check groups and status page customization
-- Self-healing: uses IF NOT EXISTS / safe column additions

-- Add group_name column to checks for grouping/folders
ALTER TABLE checks ADD COLUMN group_name TEXT DEFAULT '';

-- Add status page customization columns to users
ALTER TABLE users ADD COLUMN status_page_title TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN status_page_logo_url TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN status_page_description TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN status_page_public INTEGER DEFAULT 0;
