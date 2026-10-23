CREATE TABLE "project_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "api_key_id" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "project_api_key" ADD CONSTRAINT "project_api_key_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_api_key" ADD CONSTRAINT "project_api_key_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_api_key_hash_idx" ON "project_api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "project_api_key_project_idx" ON "project_api_key" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_api_key_id_project_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."project_api_key"("id") ON DELETE set null ON UPDATE no action;