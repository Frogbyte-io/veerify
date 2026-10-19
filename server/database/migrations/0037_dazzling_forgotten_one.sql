CREATE TABLE "conversation_status_event" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"inbox_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" text,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "conversation_status_event_status_transition_check" CHECK (("conversation_status_event"."from_status" IS NULL OR "conversation_status_event"."from_status" IN ('open', 'pending', 'resolved', 'snoozed', 'closed')) AND "conversation_status_event"."to_status" IN ('open', 'pending', 'resolved', 'snoozed', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "conversation_status_event" ADD CONSTRAINT "conversation_status_event_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_status_event" ADD CONSTRAINT "conversation_status_event_inbox_id_support_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_status_event" ADD CONSTRAINT "conversation_status_event_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_status_event" ADD CONSTRAINT "conversation_status_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_status_event_team_occurred_at_idx" ON "conversation_status_event" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE INDEX "conversation_status_event_conversation_occurred_at_idx" ON "conversation_status_event" USING btree ("conversation_id","occurred_at");