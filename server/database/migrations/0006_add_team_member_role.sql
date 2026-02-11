-- Manual migration: Add role column to team_member
ALTER TABLE "team_member" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'member' NOT NULL;
