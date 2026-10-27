CREATE TABLE "imported_person" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"email" text,
	"avatar_url" text,
	"claimed_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"product_id" text NOT NULL,
	"created_by_user_id" text,
	"source" text NOT NULL,
	"source_label" text NOT NULL,
	"on_existing" text DEFAULT 'sync' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"progress" jsonb,
	"summary" jsonb,
	"error" text,
	"lease_until" timestamp,
	"committed_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"record_count" integer NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run_issue" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"severity" text,
	"entity_type" text,
	"external_id" text,
	"message" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "import_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "imported_vote_baseline" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "imported_person_id" text;--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD COLUMN "import_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD COLUMN "imported_person_id" text;--> statement-breakpoint
ALTER TABLE "vote" ADD COLUMN "imported_person_id" text;--> statement-breakpoint
ALTER TABLE "changelog_entry" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "changelog_entry" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "changelog_entry" ADD COLUMN "import_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "imported_person" ADD CONSTRAINT "imported_person_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_person" ADD CONSTRAINT "imported_person_claimed_by_user_id_user_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run_batch" ADD CONSTRAINT "import_run_batch_run_id_import_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run_issue" ADD CONSTRAINT "import_run_issue_run_id_import_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imported_person_external_idx" ON "imported_person" USING btree ("project_id","source","external_id");--> statement-breakpoint
CREATE INDEX "imported_person_email_idx" ON "imported_person" USING btree ("email");--> statement-breakpoint
CREATE INDEX "import_run_project_created_idx" ON "import_run" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "import_run_status_idx" ON "import_run" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "import_run_batch_run_seq_idx" ON "import_run_batch" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "import_run_issue_run_idx" ON "import_run_issue" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_imported_person_id_imported_person_id_fk" FOREIGN KEY ("imported_person_id") REFERENCES "public"."imported_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD CONSTRAINT "feedback_comment_imported_person_id_imported_person_id_fk" FOREIGN KEY ("imported_person_id") REFERENCES "public"."imported_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_imported_person_id_imported_person_id_fk" FOREIGN KEY ("imported_person_id") REFERENCES "public"."imported_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_project_external_idx" ON "feedback" USING btree ("project_id","external_source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_feedback_external_idx" ON "feedback_comment" USING btree ("feedback_id","external_source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_imported_person_feedback_idx" ON "vote" USING btree ("feedback_id","imported_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_entry_project_external_idx" ON "changelog_entry" USING btree ("project_id","external_source","external_id");