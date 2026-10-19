ALTER TABLE "csat_response" ADD COLUMN "scale" text;--> statement-breakpoint
UPDATE "csat_response" AS response
SET "scale" = survey."scale"
FROM "csat_survey" AS survey
WHERE response."survey_id" = survey."id";--> statement-breakpoint
-- Keep rolling deployments safe: an older writer does not know about the
-- snapshot column and omits it. Derive the value from its survey before the
-- NOT NULL constraint is enforced, so that writer cannot create an invalid
-- response during the rollout.
CREATE FUNCTION "csat_response_set_scale"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."scale" IS NULL THEN
    SELECT "scale" INTO NEW."scale"
    FROM "csat_survey"
    WHERE "id" = NEW."survey_id";
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "csat_response_set_scale_trigger"
BEFORE INSERT OR UPDATE OF "survey_id" ON "csat_response"
FOR EACH ROW EXECUTE FUNCTION "csat_response_set_scale"();--> statement-breakpoint
ALTER TABLE "csat_response" ALTER COLUMN "scale" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support_team_settings" ADD COLUMN "reporting_timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "csat_response" ADD CONSTRAINT "csat_response_scale_check" CHECK ("csat_response"."scale" in ('csat_5','thumbs','nps_10'));
