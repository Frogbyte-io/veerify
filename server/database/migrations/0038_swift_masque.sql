ALTER TABLE "conversation_status_event" DROP CONSTRAINT "conversation_status_event_actor_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_status_event" ADD CONSTRAINT "conversation_status_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;