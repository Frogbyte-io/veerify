CREATE TABLE "support_delivery_event" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"record_type" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp,
	"processed_at" timestamp,
	"error" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_outbound_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp,
	"last_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_delivery_event" ADD CONSTRAINT "support_delivery_event_message_id_conversation_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_outbound_delivery" ADD CONSTRAINT "support_outbound_delivery_message_id_conversation_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_delivery_event_provider_event_id_idx" ON "support_delivery_event" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "support_delivery_event_message_idx" ON "support_delivery_event" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_outbound_delivery_message_kind_idx" ON "support_outbound_delivery" USING btree ("message_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "support_outbound_delivery_idempotency_key_idx" ON "support_outbound_delivery" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "support_outbound_delivery_status_idx" ON "support_outbound_delivery" USING btree ("status");