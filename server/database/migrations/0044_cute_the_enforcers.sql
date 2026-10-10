CREATE TABLE "ai_visibility_answer" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"sample" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"answer" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand_mentioned" boolean,
	"brand_rank" integer,
	"competitors_mentioned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citation_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"brand_sentiment" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_prompt" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"text" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_run" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"samples_per_prompt" integer DEFAULT 3 NOT NULL,
	"providers" text[] NOT NULL,
	"error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_site" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"origin" text NOT NULL,
	"verification_method" text,
	"verification_token" text NOT NULL,
	"verified_at" timestamp,
	"last_verification_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_term" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"competitor_domain" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_usage" (
	"team_id" text NOT NULL,
	"period" text NOT NULL,
	"metric" text NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "marketing_usage_team_id_period_metric_pk" PRIMARY KEY("team_id","period","metric")
);
--> statement-breakpoint
CREATE TABLE "mention" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"term_id" text,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"author" text,
	"title" text,
	"excerpt" text NOT NULL,
	"score" integer,
	"kind" text DEFAULT 'mention' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"published_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mention_source_cursor" (
	"site_id" text NOT NULL,
	"source" text NOT NULL,
	"last_polled_at" timestamp NOT NULL,
	"last_error" text,
	CONSTRAINT "mention_source_cursor_site_id_source_pk" PRIMARY KEY("site_id","source")
);
--> statement-breakpoint
CREATE TABLE "seo_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"trigger" text NOT NULL,
	"mode" text DEFAULT 'basic' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"crawl_provider" text,
	"crawl_job_id" text,
	"crawl_cursor" text,
	"page_limit" integer NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"score" integer,
	"site_facts" jsonb,
	"error" text,
	"requested_by_user_id" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_audit_page" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"url" text NOT NULL,
	"status_code" integer NOT NULL,
	"facts" jsonb NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_issue" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"page_id" text,
	"page_url" text,
	"rule_id" text NOT NULL,
	"severity" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_api_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_hint" text NOT NULL,
	"monthly_budget_cents" integer,
	"status" text DEFAULT 'unchecked' NOT NULL,
	"last_validated_at" timestamp,
	"last_error" text,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_module_settings" ADD COLUMN "marketing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_visibility_answer" ADD CONSTRAINT "ai_visibility_answer_run_id_ai_visibility_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_visibility_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_answer" ADD CONSTRAINT "ai_visibility_answer_prompt_id_ai_visibility_prompt_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_visibility_prompt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_prompt" ADD CONSTRAINT "ai_visibility_prompt_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_run" ADD CONSTRAINT "ai_visibility_run_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_site" ADD CONSTRAINT "marketing_site_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_site" ADD CONSTRAINT "marketing_site_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_term" ADD CONSTRAINT "marketing_term_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_usage" ADD CONSTRAINT "marketing_usage_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_term_id_marketing_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."marketing_term"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_source_cursor" ADD CONSTRAINT "mention_source_cursor_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_audit" ADD CONSTRAINT "seo_audit_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_audit" ADD CONSTRAINT "seo_audit_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_audit_page" ADD CONSTRAINT "seo_audit_page_audit_id_seo_audit_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."seo_audit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_issue" ADD CONSTRAINT "seo_issue_audit_id_seo_audit_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."seo_audit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_issue" ADD CONSTRAINT "seo_issue_page_id_seo_audit_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."seo_audit_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_api_credential" ADD CONSTRAINT "team_api_credential_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_api_credential" ADD CONSTRAINT "team_api_credential_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visibility_answer_sample_idx" ON "ai_visibility_answer" USING btree ("run_id","prompt_id","provider","sample");--> statement-breakpoint
CREATE INDEX "ai_visibility_answer_prompt_idx" ON "ai_visibility_answer" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX "ai_visibility_prompt_site_idx" ON "ai_visibility_prompt" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "ai_visibility_run_site_created_idx" ON "ai_visibility_run" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_site_project_idx" ON "marketing_site" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "marketing_site_team_idx" ON "marketing_site" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "marketing_term_site_kind_idx" ON "marketing_term" USING btree ("site_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "mention_site_source_external_idx" ON "mention" USING btree ("site_id","source","external_id");--> statement-breakpoint
CREATE INDEX "mention_site_status_published_idx" ON "mention" USING btree ("site_id","status","published_at");--> statement-breakpoint
CREATE INDEX "seo_audit_site_created_idx" ON "seo_audit" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "seo_audit_status_idx" ON "seo_audit" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_audit_page_audit_url_idx" ON "seo_audit_page" USING btree ("audit_id","url");--> statement-breakpoint
CREATE INDEX "seo_issue_audit_rule_idx" ON "seo_issue" USING btree ("audit_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_api_credential_team_provider_idx" ON "team_api_credential" USING btree ("team_id","provider");