CREATE TABLE "changelog_post" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text,
	"is_draft" boolean NOT NULL,
	"published_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_mode" text NOT NULL,
	"status" text NOT NULL,
	"content_scope" jsonb,
	"mapping_config" jsonb,
	"summary" jsonb,
	"progress_completed" integer NOT NULL,
	"progress_total" integer NOT NULL,
	"snapshot_key" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run_issue" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"severity" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text,
	"message" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changelog_post" ADD CONSTRAINT "changelog_post_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run_issue" ADD CONSTRAINT "import_run_issue_run_id_import_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changelog_project_idx" ON "changelog_post" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "changelog_project_draft_idx" ON "changelog_post" USING btree ("project_id","is_draft");--> statement-breakpoint
CREATE INDEX "changelog_project_published_at_idx" ON "changelog_post" USING btree ("project_id","published_at");--> statement-breakpoint
CREATE INDEX "import_run_project_idx" ON "import_run" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "import_run_project_created_at_idx" ON "import_run" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "import_run_status_idx" ON "import_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_issue_run_idx" ON "import_run_issue" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "import_issue_run_severity_idx" ON "import_run_issue" USING btree ("run_id","severity");