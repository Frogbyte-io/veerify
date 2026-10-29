ALTER TABLE "conversation" ADD COLUMN "mail_address_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "behaviour" text DEFAULT 'helpdesk' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_mail_address_id_project_mail_address_id_fk" FOREIGN KEY ("mail_address_id") REFERENCES "public"."project_mail_address"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_mail_address_idx" ON "conversation" USING btree ("mail_address_id");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_behaviour_check" CHECK ("conversation"."behaviour" in ('mail','helpdesk'));