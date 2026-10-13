CREATE TABLE "support_attachment_upload" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"temp_storage_key" text NOT NULL,
	"final_storage_key" text,
	"file_name" text NOT NULL,
	"requested_content_type" text NOT NULL,
	"requested_size_bytes" integer NOT NULL,
	"stored_content_type" text,
	"actual_size_bytes" integer,
	"object_version" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"uploaded_at" timestamp,
	"consumed_at" timestamp,
	"temp_deleted_at" timestamp,
	"finalize_lease_expires_at" timestamp,
	"cleanup_attempt_count" integer DEFAULT 0 NOT NULL,
	"cleanup_last_error" text,
	"message_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "support_attachment_upload_status_check" CHECK ("support_attachment_upload"."status" in ('pending','uploaded','finalizing','cleanup_required','consumed','expired'))
);
--> statement-breakpoint
ALTER TABLE "support_delivery_event" ADD COLUMN "provider_account_key" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_delivery_event" ADD COLUMN "correlation_key" text;--> statement-breakpoint
ALTER TABLE "support_delivery_event" ADD COLUMN "occurred_at" timestamp;--> statement-breakpoint
ALTER TABLE "support_outbound_delivery" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "support_outbound_delivery" ADD COLUMN "provider_account_key" text;--> statement-breakpoint
ALTER TABLE "support_outbound_delivery" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "support_outbound_delivery" ADD COLUMN "next_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "support_attachment_upload" ADD CONSTRAINT "support_attachment_upload_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_attachment_upload" ADD CONSTRAINT "support_attachment_upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_attachment_upload" ADD CONSTRAINT "support_attachment_upload_message_id_conversation_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_attachment_upload_conversation_status_idx" ON "support_attachment_upload" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "support_attachment_upload_user_status_idx" ON "support_attachment_upload" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "support_attachment_upload_status_expiry_idx" ON "support_attachment_upload" USING btree ("status","expires_at");