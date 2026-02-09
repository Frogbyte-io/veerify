-- Team-primary workspace migration
-- 1) Schema prep (nullable project.team_id, no required FK yet)
-- 2) Deterministic backfill (default teams + memberships + project assignment)
-- 3) Constraint hardening (NOT NULL + FK + indexes)

-- =========================================================
-- Schema prep
-- =========================================================

ALTER TABLE "session" ADD COLUMN "active_team_id" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "team_id" text;--> statement-breakpoint

CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE "team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "team" ADD CONSTRAINT "team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Add DB-level timestamp defaults on existing auth/workspace tables
ALTER TABLE "organization" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint

-- =========================================================
-- Backfill
-- =========================================================

-- Create one deterministic Default team per organization
INSERT INTO "team" ("id", "name", "organization_id", "created_at", "updated_at")
SELECT
	'team_default_' || o.id,
	'Default',
	o.id,
	COALESCE(o.created_at, now()),
	now()
FROM "organization" o
WHERE NOT EXISTS (
	SELECT 1
	FROM "team" t
	WHERE t.organization_id = o.id
	  AND t.name = 'Default'
);--> statement-breakpoint

-- Backfill team membership for all organization members into each org default team
INSERT INTO "team_member" ("id", "team_id", "user_id", "created_at")
SELECT
	'tm_default_' || m.id,
	t.id,
	m.user_id,
	COALESCE(m.created_at, now())
FROM "member" m
JOIN "team" t
  ON t.organization_id = m.organization_id
 AND t.name = 'Default'
LEFT JOIN "team_member" tm
  ON tm.team_id = t.id
 AND tm.user_id = m.user_id
WHERE tm.id IS NULL;--> statement-breakpoint

-- Backfill project.team_id using org default team
UPDATE "project" p
SET "team_id" = t.id
FROM "team" t
WHERE p.organization_id = t.organization_id
  AND t.name = 'Default'
  AND p.team_id IS NULL;--> statement-breakpoint

-- Backfill active team using active organization default team
UPDATE "session" s
SET "active_team_id" = t.id
FROM "team" t
WHERE s.active_organization_id = t.organization_id
  AND t.name = 'Default'
  AND s.active_team_id IS NULL;--> statement-breakpoint

-- Ensure active organization matches active team organization for existing rows
UPDATE "session" s
SET "active_organization_id" = t.organization_id
FROM "team" t
WHERE s.active_team_id = t.id
  AND s.active_organization_id IS DISTINCT FROM t.organization_id;--> statement-breakpoint

-- =========================================================
-- Constraint hardening
-- =========================================================

ALTER TABLE "project" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "project" ADD CONSTRAINT "project_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_team_id_team_id_fk" FOREIGN KEY ("active_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "team_org_idx" ON "team" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_team_user_unique" ON "team_member" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_member_user_idx" ON "team_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_team_idx" ON "project" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "project_team_created_at_idx" ON "project" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_org_slug_idx" ON "project" USING btree ("organization_id","slug");--> statement-breakpoint

-- =========================================================
-- Triggers: enforce updated_at mutation
-- =========================================================

CREATE OR REPLACE FUNCTION "set_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "organization_set_updated_at" ON "organization";--> statement-breakpoint
CREATE TRIGGER "organization_set_updated_at"
BEFORE UPDATE ON "organization"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "member_set_updated_at" ON "member";--> statement-breakpoint
CREATE TRIGGER "member_set_updated_at"
BEFORE UPDATE ON "member"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "invitation_set_updated_at" ON "invitation";--> statement-breakpoint
CREATE TRIGGER "invitation_set_updated_at"
BEFORE UPDATE ON "invitation"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "project_set_updated_at" ON "project";--> statement-breakpoint
CREATE TRIGGER "project_set_updated_at"
BEFORE UPDATE ON "project"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "team_set_updated_at" ON "team";--> statement-breakpoint
CREATE TRIGGER "team_set_updated_at"
BEFORE UPDATE ON "team"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint

-- =========================================================
-- Session lockstep invariant: active team determines active org
-- =========================================================

CREATE OR REPLACE FUNCTION "enforce_session_team_org_lockstep"()
RETURNS TRIGGER AS $$
DECLARE
	team_org_id text;
BEGIN
	IF NEW.active_team_id IS NULL THEN
		RETURN NEW;
	END IF;

	SELECT t.organization_id INTO team_org_id
	FROM team t
	WHERE t.id = NEW.active_team_id;

	IF team_org_id IS NULL THEN
		RAISE EXCEPTION 'Active team % does not exist', NEW.active_team_id;
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM team_member tm
		WHERE tm.team_id = NEW.active_team_id
		  AND tm.user_id = NEW.user_id
	) THEN
		RAISE EXCEPTION 'User % is not a member of active team %', NEW.user_id, NEW.active_team_id;
	END IF;

	NEW.active_organization_id = team_org_id;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "session_team_org_lockstep" ON "session";--> statement-breakpoint
CREATE TRIGGER "session_team_org_lockstep"
BEFORE INSERT OR UPDATE ON "session"
FOR EACH ROW
EXECUTE FUNCTION "enforce_session_team_org_lockstep"();
