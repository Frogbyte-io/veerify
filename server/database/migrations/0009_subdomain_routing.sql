-- Subdomain routing migration
-- 1) Add nullable slug column to team
-- 2) Backfill slugs from team names / org slugs
-- 3) Handle duplicates
-- 4) Constraint hardening
-- 5) Change project slug uniqueness from per-org to per-team

-- =========================================================
-- Schema prep
-- =========================================================

ALTER TABLE "team" ADD COLUMN "slug" text;--> statement-breakpoint

-- =========================================================
-- Backfill team slugs
-- =========================================================

-- Default teams: use the organization's slug directly
UPDATE "team" t
SET "slug" = LOWER(REGEXP_REPLACE(o.slug, '[^a-z0-9-]', '', 'g'))
FROM "organization" o
WHERE t.organization_id = o.id
  AND t.name = 'Default'
  AND t.slug IS NULL
  AND o.slug IS NOT NULL;--> statement-breakpoint

-- Non-default teams: use orgslug-teamname format
UPDATE "team" t
SET "slug" = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(o.slug || '-' || t.name, '[^a-zA-Z0-9\s-]', '', 'g'),
    '\s+', '-', 'g'
  )
)
FROM "organization" o
WHERE t.organization_id = o.id
  AND t.slug IS NULL
  AND o.slug IS NOT NULL;--> statement-breakpoint

-- Fallback for teams whose org has no slug
UPDATE "team"
SET "slug" = 'team-' || SUBSTRING(id, 1, 8)
WHERE "slug" IS NULL;--> statement-breakpoint

-- Ensure slugs only contain valid characters (lowercase, numbers, hyphens)
UPDATE "team"
SET "slug" = LOWER(REGEXP_REPLACE("slug", '[^a-z0-9-]', '-', 'g'))
WHERE "slug" ~ '[^a-z0-9-]';--> statement-breakpoint

-- Trim leading/trailing hyphens
UPDATE "team"
SET "slug" = TRIM(BOTH '-' FROM "slug")
WHERE "slug" ~ '^-|-$';--> statement-breakpoint

-- Replace multiple consecutive hyphens with single hyphen
UPDATE "team"
SET "slug" = REGEXP_REPLACE("slug", '-{2,}', '-', 'g')
WHERE "slug" ~ '-{2,}';--> statement-breakpoint

-- Handle reserved slug collisions (append -workspace)
UPDATE "team"
SET "slug" = "slug" || '-workspace'
WHERE "slug" IN (
  'www', 'app', 'api', 'admin', 'docs', 'help', 'support', 'status',
  'blog', 'mail', 'smtp', 'ftp', 'static', 'assets', 'cdn', 'login',
  'signup', 'auth', 'dashboard', 'settings', 'feedback', 'products',
  'reports', 'billing', 'team', 'teams', 'org', 'organization',
  'localhost', 'staging', 'dev', 'test'
);--> statement-breakpoint

-- Handle duplicates: keep oldest team's slug, append numeric suffix to newer ones
DO $$
DECLARE
  dup_slug text;
  dup_ids text[];
  i integer;
BEGIN
  FOR dup_slug IN
    SELECT slug FROM team GROUP BY slug HAVING count(*) > 1
  LOOP
    SELECT array_agg(id ORDER BY created_at ASC) INTO dup_ids
    FROM team WHERE slug = dup_slug;

    FOR i IN 2..array_length(dup_ids, 1) LOOP
      UPDATE team
      SET slug = dup_slug || '-' || (i - 1)
      WHERE id = dup_ids[i];
    END LOOP;
  END LOOP;
END $$;--> statement-breakpoint

-- =========================================================
-- Constraint hardening
-- =========================================================

ALTER TABLE "team" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "team_slug_unique" ON "team" USING btree ("slug");--> statement-breakpoint

-- =========================================================
-- Change project slug uniqueness from per-org to per-team
-- =========================================================

DROP INDEX IF EXISTS "project_org_slug_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "project_team_slug_idx" ON "project" USING btree ("team_id", "slug");--> statement-breakpoint

