CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"inbox_id" text NOT NULL,
	"team_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"project_id" text,
	"display_id" integer NOT NULL,
	"subject" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text,
	"assignee_user_id" text,
	"linked_feedback_id" text,
	"channel_thread_key" text,
	"first_response_at" timestamp,
	"resolved_at" timestamp,
	"snoozed_until" timestamp,
	"last_activity_at" timestamp,
	"last_customer_reply_at" timestamp,
	"last_agent_reply_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"is_inline" boolean DEFAULT false NOT NULL,
	"content_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"body_html" text,
	"sender_kind" text NOT NULL,
	"sender_contact_id" text,
	"sender_user_id" text,
	"is_private" boolean DEFAULT false NOT NULL,
	"channel_message_id" text,
	"in_reply_to" text,
	"channel_headers" jsonb,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"delivery_error" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text,
	"user_id" text,
	"role" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_counter" (
	"team_id" text PRIMARY KEY NOT NULL,
	"next_conversation_display_id" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_email_event" (
	"id" text PRIMARY KEY NOT NULL,
	"inbox_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"raw_storage_key" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp,
	"processed_at" timestamp,
	"result_conversation_id" text,
	"error" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" text DEFAULT 'email' NOT NULL,
	"channel_config" jsonb,
	"email_address" text,
	"forward_address" text,
	"from_name" text,
	"signature" text,
	"auto_reply_enabled" boolean DEFAULT false NOT NULL,
	"auto_reply_template" text,
	"default_assignee_user_id" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_inbox_address" (
	"id" text PRIMARY KEY NOT NULL,
	"inbox_id" text NOT NULL,
	"address" text NOT NULL,
	"project_id" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_inbox_member" (
	"id" text PRIMARY KEY NOT NULL,
	"inbox_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_inbox_id_support_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_linked_feedback_id_feedback_id_fk" FOREIGN KEY ("linked_feedback_id") REFERENCES "public"."feedback"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attachment" ADD CONSTRAINT "conversation_attachment_message_id_conversation_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_sender_contact_id_contact_id_fk" FOREIGN KEY ("sender_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tag" ADD CONSTRAINT "conversation_tag_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tag" ADD CONSTRAINT "conversation_tag_tag_id_support_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."support_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_counter" ADD CONSTRAINT "support_counter_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_email_event" ADD CONSTRAINT "support_email_event_inbox_id_support_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_email_event" ADD CONSTRAINT "support_email_event_result_conversation_id_conversation_id_fk" FOREIGN KEY ("result_conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbox" ADD CONSTRAINT "support_inbox_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbox" ADD CONSTRAINT "support_inbox_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbox" ADD CONSTRAINT "support_inbox_default_assignee_user_id_user_id_fk" FOREIGN KEY ("default_assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbox_address" ADD CONSTRAINT "support_inbox_address_inbox_id_support_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbox_address" ADD CONSTRAINT "support_inbox_address_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbox_member" ADD CONSTRAINT "support_inbox_member_inbox_id_support_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbox_member" ADD CONSTRAINT "support_inbox_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tag" ADD CONSTRAINT "support_tag_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_team_display_id_idx" ON "conversation" USING btree ("team_id","display_id");--> statement-breakpoint
CREATE INDEX "conversation_team_status_activity_idx" ON "conversation" USING btree ("team_id","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "conversation_inbox_status_idx" ON "conversation" USING btree ("inbox_id","status");--> statement-breakpoint
CREATE INDEX "conversation_assignee_status_idx" ON "conversation" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "conversation_contact_created_at_idx" ON "conversation" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_channel_thread_key_idx" ON "conversation" USING btree ("channel_thread_key");--> statement-breakpoint
CREATE INDEX "conversation_project_status_idx" ON "conversation" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "conversation_attachment_message_idx" ON "conversation_attachment" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "conversation_message_conversation_created_at_idx" ON "conversation_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_channel_message_id_idx" ON "conversation_message" USING btree ("channel_message_id");--> statement-breakpoint
CREATE INDEX "conversation_message_delivery_status_idx" ON "conversation_message" USING btree ("delivery_status");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participant_conversation_contact_idx" ON "conversation_participant" USING btree ("conversation_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participant_conversation_user_idx" ON "conversation_participant" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_tag_conversation_tag_idx" ON "conversation_tag" USING btree ("conversation_id","tag_id");--> statement-breakpoint
CREATE INDEX "conversation_tag_tag_idx" ON "conversation_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_email_event_provider_event_id_idx" ON "support_email_event" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "support_email_event_inbox_idx" ON "support_email_event" USING btree ("inbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_inbox_team_slug_idx" ON "support_inbox" USING btree ("team_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "support_inbox_email_address_idx" ON "support_inbox" USING btree ("email_address");--> statement-breakpoint
CREATE INDEX "support_inbox_team_idx" ON "support_inbox" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "support_inbox_project_idx" ON "support_inbox" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_inbox_address_address_idx" ON "support_inbox_address" USING btree ("address");--> statement-breakpoint
CREATE INDEX "support_inbox_address_inbox_idx" ON "support_inbox_address" USING btree ("inbox_id");--> statement-breakpoint
CREATE INDEX "support_inbox_address_project_idx" ON "support_inbox_address" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_inbox_member_inbox_user_idx" ON "support_inbox_member" USING btree ("inbox_id","user_id");--> statement-breakpoint
CREATE INDEX "support_inbox_member_user_idx" ON "support_inbox_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tag_team_name_idx" ON "support_tag" USING btree ("team_id","name");