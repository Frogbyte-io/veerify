CREATE TABLE "competitor_change" (
	"id" text PRIMARY KEY NOT NULL,
	"watch_id" text NOT NULL,
	"site_id" text NOT NULL,
	"detected_at" timestamp NOT NULL,
	"added_text" text DEFAULT '' NOT NULL,
	"removed_text" text DEFAULT '' NOT NULL,
	"summary" text,
	"provider" text,
	"model" text,
	"seen_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_watch" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"term_id" text NOT NULL,
	"url" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_checked_at" timestamp,
	"last_changed_at" timestamp,
	"last_content_hash" text,
	"last_text" text,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launch_kit_item" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"directory_id" text NOT NULL,
	"name" text,
	"url" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"notes" text,
	"submitted_at" timestamp,
	"live_at" timestamp,
	"updated_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mention" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "mention" ADD COLUMN "escalated_at" timestamp;--> statement-breakpoint
ALTER TABLE "competitor_change" ADD CONSTRAINT "competitor_change_watch_id_competitor_watch_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."competitor_watch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_change" ADD CONSTRAINT "competitor_change_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_watch" ADD CONSTRAINT "competitor_watch_site_id_marketing_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."marketing_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_watch" ADD CONSTRAINT "competitor_watch_term_id_marketing_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."marketing_term"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_watch" ADD CONSTRAINT "competitor_watch_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_kit_item" ADD CONSTRAINT "launch_kit_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_kit_item" ADD CONSTRAINT "launch_kit_item_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_change_site_detected_idx" ON "competitor_change" USING btree ("site_id","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_watch_site_url_idx" ON "competitor_watch" USING btree ("site_id","url");--> statement-breakpoint
CREATE INDEX "competitor_watch_status_checked_idx" ON "competitor_watch" USING btree ("status","last_checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "launch_kit_item_project_directory_idx" ON "launch_kit_item" USING btree ("project_id","directory_id");--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;