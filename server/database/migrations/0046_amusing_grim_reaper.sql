CREATE TABLE "changelog_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"published_at" timestamp,
	"author_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changelog_entry_feedback" (
	"entry_id" text NOT NULL,
	"feedback_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "changelog_entry_feedback_entry_id_feedback_id_pk" PRIMARY KEY("entry_id","feedback_id")
);
--> statement-breakpoint
CREATE TABLE "customer_language_insight" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"item_count" integer NOT NULL,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_connection" (
	"site_id" text PRIMARY KEY NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"google_account_email" text,
	"property_url" text,
	"status" text DEFAULT 'needs_property' NOT NULL,
	"last_sync_at" timestamp,
	"last_error" text,
	"connected_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_daily_metric" (
	"site_id" text NOT NULL,
	"date" date NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" double precision NOT NULL,
	"position" double precision NOT NULL,
	CONSTRAINT "gsc_daily_metric_site_id_date_pk" PRIMARY KEY("site_id","date")
);
--> statement-breakpoint
CREATE TABLE "gsc_query_stat" (
	"site_id" text NOT NULL,
	"period_end" date NOT NULL,
	"query" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" double precision NOT NULL,
	"position" double precision NOT NULL,
	CONSTRAINT "gsc_query_stat_site_id_period_end_query_pk" PRIMARY KEY("site_id","period_end","query")
);
--> statement-breakpoint
CREATE TABLE "marketing_announcement_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"project_id" text NOT NULL,
	"channel" text NOT NULL,
	"content" text NOT NULL,
	"provider" text,
	"model" text,
	"edited" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_data_consent" (
	"team_id" text PRIMARY KEY NOT NULL,
	"allow_feedback_text" boolean DEFAULT false NOT NULL,
	"allow_support_text" boolean DEFAULT false NOT NULL,
	"consented_by_user_id" text,
	"consented_at" timestamp,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_email_suppression" (
	"team_id" text NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "marketing_email_suppression_team_id_email_pk" PRIMARY KEY("team_id","email")
);
--> statement-breakpoint
CREATE TABLE "review_request" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"trigger" text NOT NULL,
	"source_id" text,
	"token" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"error" text,
	"sent_at" timestamp,
	"clicked_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_request_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ask_for_testimonial" boolean DEFAULT true NOT NULL,
	"csat_trigger" boolean DEFAULT true NOT NULL,
	"csat_min_rating" integer,
	"shipped_trigger" boolean DEFAULT true NOT NULL,
	"shipped_status_values" text[] DEFAULT '{completed}'::text[] NOT NULL,
	"cooldown_days" integer DEFAULT 90 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "testimonial" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"review_request_id" text,
	"author_name" text NOT NULL,
	"author_title" text,
	"author_company" text,
	"author_email" text,
	"quote" text NOT NULL,
	"rating" integer,
	"consent_public" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"moderated_at" timestamp,
	"moderated_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changelog_entry" ADD CONSTRAINT "changelog_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entry" ADD CONSTRAINT "changelog_entry_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entry_feedback" ADD CONSTRAINT "changelog_entry_feedback_entry_id_changelog_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."changelog_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entry_feedback" ADD CONSTRAINT "changelog_entry_feedback_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_language_insight" ADD CONSTRAINT "customer_language_insight_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_language_insight" ADD CONSTRAINT "customer_language_insight_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_connection" ADD CONSTRAINT "gsc_connection_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_connection" ADD CONSTRAINT "gsc_connection_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_daily_metric" ADD CONSTRAINT "gsc_daily_metric_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_stat" ADD CONSTRAINT "gsc_query_stat_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_announcement_draft" ADD CONSTRAINT "marketing_announcement_draft_entry_id_changelog_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."changelog_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_announcement_draft" ADD CONSTRAINT "marketing_announcement_draft_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_announcement_draft" ADD CONSTRAINT "marketing_announcement_draft_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_data_consent" ADD CONSTRAINT "marketing_data_consent_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_data_consent" ADD CONSTRAINT "marketing_data_consent_consented_by_user_id_user_id_fk" FOREIGN KEY ("consented_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_email_suppression" ADD CONSTRAINT "marketing_email_suppression_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_request_settings" ADD CONSTRAINT "review_request_settings_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonial" ADD CONSTRAINT "testimonial_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonial" ADD CONSTRAINT "testimonial_review_request_id_review_request_id_fk" FOREIGN KEY ("review_request_id") REFERENCES "public"."review_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonial" ADD CONSTRAINT "testimonial_moderated_by_user_id_user_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_entry_project_slug_idx" ON "changelog_entry" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "changelog_entry_project_status_published_idx" ON "changelog_entry" USING btree ("project_id","status","published_at");--> statement-breakpoint
CREATE INDEX "changelog_entry_feedback_feedback_idx" ON "changelog_entry_feedback" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "customer_language_insight_site_created_idx" ON "customer_language_insight" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "gsc_query_stat_site_period_idx" ON "gsc_query_stat" USING btree ("site_id","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_announcement_draft_entry_channel_idx" ON "marketing_announcement_draft" USING btree ("entry_id","channel");--> statement-breakpoint
CREATE INDEX "marketing_announcement_draft_project_idx" ON "marketing_announcement_draft" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_request_token_idx" ON "review_request" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "review_request_event_idx" ON "review_request" USING btree ("project_id","trigger","source_id","email");--> statement-breakpoint
CREATE INDEX "review_request_project_email_idx" ON "review_request" USING btree ("project_id","email","created_at");--> statement-breakpoint
CREATE INDEX "review_request_status_idx" ON "review_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "testimonial_project_status_idx" ON "testimonial" USING btree ("project_id","status","created_at");