ALTER TABLE "csat_response" ADD COLUMN "scale" text;--> statement-breakpoint
UPDATE "csat_response" AS response
SET "scale" = survey."scale"
FROM "csat_survey" AS survey
WHERE response."survey_id" = survey."id";--> statement-breakpoint
ALTER TABLE "csat_response" ALTER COLUMN "scale" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support_team_settings" ADD COLUMN "reporting_timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "csat_response" ADD CONSTRAINT "csat_response_scale_check" CHECK ("csat_response"."scale" in ('csat_5','thumbs','nps_10'));
