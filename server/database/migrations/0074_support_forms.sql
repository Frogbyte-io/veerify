CREATE TABLE "support_form" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"inbox_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"public_id" text NOT NULL,
	"fields" jsonb NOT NULL,
	"field_mapping" jsonb NOT NULL,
	"auto_reply_mode" text DEFAULT 'inbox' NOT NULL,
	"auto_reply_template" text,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"browser_submissions_enabled" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "support_form_auto_reply_mode_check" CHECK ("support_form"."auto_reply_mode" in ('inbox','custom','off'))
);
--> statement-breakpoint
CREATE TABLE "support_form_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"project_id" text NOT NULL,
	"conversation_id" text,
	"message_id" text,
	"source" text NOT NULL,
	"api_key_id" text,
	"idempotency_key" text,
	"request_hash" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "support_form_submission_source_check" CHECK ("support_form_submission"."source" in ('api','browser'))
);
--> statement-breakpoint
ALTER TABLE "project_api_key" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project_api_key" ADD COLUMN "kind" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_form" ADD CONSTRAINT "support_form_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_form" ADD CONSTRAINT "support_form_inbox_id_support_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_form" ADD CONSTRAINT "support_form_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_form_submission" ADD CONSTRAINT "support_form_submission_form_id_support_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."support_form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_form_submission" ADD CONSTRAINT "support_form_submission_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_form_submission" ADD CONSTRAINT "support_form_submission_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_form_submission" ADD CONSTRAINT "support_form_submission_message_id_conversation_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_form_submission" ADD CONSTRAINT "support_form_submission_api_key_id_project_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."project_api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_form_project_slug_idx" ON "support_form" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "support_form_public_id_idx" ON "support_form" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "support_form_inbox_idx" ON "support_form" USING btree ("inbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_form_submission_idempotency_idx" ON "support_form_submission" USING btree ("form_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "support_form_submission_form_created_idx" ON "support_form_submission" USING btree ("form_id","created_at");--> statement-breakpoint
ALTER TABLE "project_api_key" ADD CONSTRAINT "project_api_key_kind_check" CHECK ("project_api_key"."kind" in ('app','server'));--> statement-breakpoint
ALTER TABLE "project_api_key" ADD CONSTRAINT "project_api_key_product_check" CHECK (("project_api_key"."kind" = 'app' and "project_api_key"."product_id" is not null) or ("project_api_key"."kind" = 'server' and "project_api_key"."product_id" is null));