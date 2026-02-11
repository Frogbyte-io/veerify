-- Manual migration: Add role column to team_member
-- This migration was applied manually because Drizzle's snapshot state was inconsistent
-- The column has already been added to the database via direct SQL

-- ALTER TABLE "team_member" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;
-- (Already applied - this file is for version tracking only)
