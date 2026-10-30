CREATE TABLE "mail_forward_destination" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain_id" text NOT NULL,
	"email" text NOT NULL,
	"frogmail_destination_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"verification_sent_at" timestamp,
	"verified_at" timestamp,
	"last_event_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "mail_forward_destination_status_check" CHECK ("mail_forward_destination"."status" in ('pending','verified','revoked','suspended'))
);
--> statement-breakpoint
CREATE TABLE "project_mail_address_forward" (
	"address_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "project_mail_address_forward_address_id_destination_id_pk" PRIMARY KEY("address_id","destination_id")
);
--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD COLUMN "deliver_to_inbox" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD COLUMN "receiving_status" text;--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD COLUMN "forwarding_paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "mail_forward_destination" ADD CONSTRAINT "mail_forward_destination_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_forward_destination" ADD CONSTRAINT "mail_forward_destination_domain_id_project_mail_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."project_mail_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_mail_address_forward" ADD CONSTRAINT "project_mail_address_forward_address_id_project_mail_address_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."project_mail_address"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_mail_address_forward" ADD CONSTRAINT "project_mail_address_forward_destination_id_mail_forward_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."mail_forward_destination"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_forward_destination_domain_email_idx" ON "mail_forward_destination" USING btree ("domain_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_forward_destination_frogmail_idx" ON "mail_forward_destination" USING btree ("frogmail_destination_id");--> statement-breakpoint
CREATE INDEX "mail_forward_destination_project_idx" ON "mail_forward_destination" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_mail_address_forward_destination_idx" ON "project_mail_address_forward" USING btree ("destination_id");--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD CONSTRAINT "project_mail_domain_receiving_status_check" CHECK ("project_mail_domain"."receiving_status" is null or "project_mail_domain"."receiving_status" in ('pending_verification','pending_mx','active','disabled'));