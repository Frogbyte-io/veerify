ALTER TABLE "team" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_member" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roadmap_item" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_team_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_module_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_api_credential" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "team" CASCADE;--> statement-breakpoint
DROP TABLE "team_member" CASCADE;--> statement-breakpoint
DROP TABLE "roadmap_item" CASCADE;--> statement-breakpoint
DROP TABLE "support_team_settings" CASCADE;--> statement-breakpoint
DROP TABLE "team_module_settings" CASCADE;--> statement-breakpoint
DROP TABLE "team_api_credential" CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT IF EXISTS "invitation_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_rule" DROP CONSTRAINT IF EXISTS "automation_rule_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "business_hours" DROP CONSTRAINT IF EXISTS "business_hours_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "canned_response" DROP CONSTRAINT IF EXISTS "canned_response_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "contact" DROP CONSTRAINT IF EXISTS "contact_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "contact_identity" DROP CONSTRAINT IF EXISTS "contact_identity_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_status_event" DROP CONSTRAINT IF EXISTS "conversation_status_event_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "csat_survey" DROP CONSTRAINT IF EXISTS "csat_survey_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "sla_policy" DROP CONSTRAINT IF EXISTS "sla_policy_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "support_company" DROP CONSTRAINT IF EXISTS "support_company_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "support_counter" DROP CONSTRAINT IF EXISTS "support_counter_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "support_inbox" DROP CONSTRAINT IF EXISTS "support_inbox_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "support_inbox" DROP CONSTRAINT IF EXISTS "support_inbox_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "support_inbox_address" DROP CONSTRAINT IF EXISTS "support_inbox_address_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "support_metric_daily" DROP CONSTRAINT IF EXISTS "support_metric_daily_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "support_metric_daily" DROP CONSTRAINT IF EXISTS "support_metric_daily_team_inbox_ownership_fk";
--> statement-breakpoint
ALTER TABLE "support_sending_domain" DROP CONSTRAINT IF EXISTS "support_sending_domain_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "support_tag" DROP CONSTRAINT IF EXISTS "support_tag_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "marketing_data_consent" DROP CONSTRAINT IF EXISTS "marketing_data_consent_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "marketing_email_suppression" DROP CONSTRAINT IF EXISTS "marketing_email_suppression_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "marketing_site" DROP CONSTRAINT IF EXISTS "marketing_site_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "marketing_usage" DROP CONSTRAINT IF EXISTS "marketing_usage_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "review_request" DROP CONSTRAINT IF EXISTS "review_request_team_id_team_id_fk";
--> statement-breakpoint
DROP INDEX "project_team_slug_idx";--> statement-breakpoint
DROP INDEX "project_team_idx";--> statement-breakpoint
DROP INDEX "project_team_created_at_idx";--> statement-breakpoint
DROP INDEX "automation_rule_team_idx";--> statement-breakpoint
DROP INDEX "business_hours_team_idx";--> statement-breakpoint
DROP INDEX "canned_response_team_shortcode_idx";--> statement-breakpoint
DROP INDEX "contact_team_email_idx";--> statement-breakpoint
DROP INDEX "contact_team_created_at_idx";--> statement-breakpoint
DROP INDEX "contact_identity_team_kind_value_idx";--> statement-breakpoint
DROP INDEX "conversation_team_display_id_idx";--> statement-breakpoint
DROP INDEX "conversation_team_status_activity_idx";--> statement-breakpoint
DROP INDEX "conversation_status_event_team_occurred_at_idx";--> statement-breakpoint
DROP INDEX "csat_survey_team_idx";--> statement-breakpoint
DROP INDEX "sla_policy_team_idx";--> statement-breakpoint
DROP INDEX "sla_policy_team_order_idx";--> statement-breakpoint
DROP INDEX "support_company_team_domain_idx";--> statement-breakpoint
DROP INDEX "support_company_team_name_idx";--> statement-breakpoint
DROP INDEX "support_inbox_team_slug_idx";--> statement-breakpoint
DROP INDEX "support_inbox_team_id_idx";--> statement-breakpoint
DROP INDEX "support_inbox_team_idx";--> statement-breakpoint
DROP INDEX "support_metric_daily_team_inbox_date_tz_metric_null_idx";--> statement-breakpoint
DROP INDEX "support_metric_daily_team_inbox_agent_date_tz_metric_idx";--> statement-breakpoint
DROP INDEX "support_metric_daily_team_date_idx";--> statement-breakpoint
DROP INDEX "support_sending_domain_team_idx";--> statement-breakpoint
DROP INDEX "support_tag_team_name_idx";--> statement-breakpoint
DROP INDEX "marketing_site_team_idx";--> statement-breakpoint
DROP INDEX "review_request_team_trigger_created_idx";--> statement-breakpoint
DROP INDEX "automation_rule_enabled_order_idx";--> statement-breakpoint
DROP INDEX "business_hours_default_idx";--> statement-breakpoint
DROP INDEX "csat_survey_enabled_idx";--> statement-breakpoint
DROP INDEX "marketing_email_suppression_hash_idx";--> statement-breakpoint
ALTER TABLE "marketing_email_suppression" DROP CONSTRAINT IF EXISTS "marketing_email_suppression_team_id_email_pk";--> statement-breakpoint
ALTER TABLE "marketing_usage" DROP CONSTRAINT IF EXISTS "marketing_usage_team_id_period_metric_pk";--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "product_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_rule" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "business_hours" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "canned_response" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_identity" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_status_event" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "csat_survey" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sla_policy" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support_company" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support_counter" DROP CONSTRAINT IF EXISTS "support_counter_pkey";--> statement-breakpoint
ALTER TABLE "support_counter" ADD PRIMARY KEY ("project_id");--> statement-breakpoint
ALTER TABLE "support_counter" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support_inbox" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support_inbox_address" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support_metric_daily" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support_sending_domain" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tag" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_data_consent" DROP CONSTRAINT IF EXISTS "marketing_data_consent_pkey";--> statement-breakpoint
ALTER TABLE "marketing_data_consent" ADD PRIMARY KEY ("organization_id");--> statement-breakpoint
ALTER TABLE "marketing_data_consent" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_email_suppression" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_usage" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_email_suppression" ADD CONSTRAINT "marketing_email_suppression_organization_id_email_pk" PRIMARY KEY("organization_id","email");--> statement-breakpoint
ALTER TABLE "marketing_usage" ADD CONSTRAINT "marketing_usage_organization_id_period_metric_pk" PRIMARY KEY("organization_id","period","metric");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbox" ADD CONSTRAINT "support_inbox_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbox_address" ADD CONSTRAINT "support_inbox_address_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_project_product_idx" ON "feedback" USING btree ("project_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_slug_idx" ON "project" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "project_org_created_at_idx" ON "project" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_rule_project_idx" ON "automation_rule" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "business_hours_project_idx" ON "business_hours" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canned_response_project_shortcode_idx" ON "canned_response" USING btree ("project_id","shortcode");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_project_email_idx" ON "contact" USING btree ("project_id","email");--> statement-breakpoint
CREATE INDEX "contact_project_created_at_idx" ON "contact" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identity_project_kind_value_idx" ON "contact_identity" USING btree ("project_id","kind","value");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_project_display_id_idx" ON "conversation" USING btree ("project_id","display_id");--> statement-breakpoint
CREATE INDEX "conversation_project_status_activity_idx" ON "conversation" USING btree ("project_id","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "conversation_status_event_project_occurred_at_idx" ON "conversation_status_event" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "csat_survey_project_idx" ON "csat_survey" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sla_policy_project_idx" ON "sla_policy" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sla_policy_project_order_idx" ON "sla_policy" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "support_company_project_domain_idx" ON "support_company" USING btree ("project_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "support_company_project_name_idx" ON "support_company" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "support_inbox_project_slug_idx" ON "support_inbox" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "support_inbox_project_id_idx" ON "support_inbox" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_metric_daily_project_inbox_date_tz_metric_null_idx" ON "support_metric_daily" USING btree ("project_id","inbox_id","date","timezone","metric") WHERE "support_metric_daily"."agent_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "support_metric_daily_project_inbox_agent_date_tz_metric_idx" ON "support_metric_daily" USING btree ("project_id","inbox_id","agent_user_id","date","timezone","metric") WHERE "support_metric_daily"."agent_user_id" is not null;--> statement-breakpoint
CREATE INDEX "support_metric_daily_project_date_idx" ON "support_metric_daily" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "support_sending_domain_project_idx" ON "support_sending_domain" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tag_project_name_idx" ON "support_tag" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "review_request_project_trigger_created_idx" ON "review_request" USING btree ("project_id","trigger","created_at");--> statement-breakpoint
CREATE INDEX "automation_rule_enabled_order_idx" ON "automation_rule" USING btree ("project_id","is_enabled","sort_order");--> statement-breakpoint
CREATE INDEX "business_hours_default_idx" ON "business_hours" USING btree ("project_id","is_default");--> statement-breakpoint
CREATE INDEX "csat_survey_enabled_idx" ON "csat_survey" USING btree ("project_id","is_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_email_suppression_hash_idx" ON "marketing_email_suppression" USING btree ("organization_id","email_hash");--> statement-breakpoint
ALTER TABLE "invitation" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "active_team_id";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "automation_rule" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "business_hours" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "canned_response" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "contact" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "contact_identity" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "conversation" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "conversation_status_event" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "csat_survey" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "sla_policy" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "support_company" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "support_counter" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "support_inbox" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "support_metric_daily" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "support_sending_domain" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "support_tag" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "marketing_data_consent" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "marketing_email_suppression" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "marketing_site" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "marketing_usage" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "review_request" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "support_metric_daily" ADD CONSTRAINT "support_metric_daily_project_inbox_ownership_fk" FOREIGN KEY ("project_id","inbox_id") REFERENCES "public"."support_inbox"("project_id","id") ON DELETE cascade ON UPDATE no action;
