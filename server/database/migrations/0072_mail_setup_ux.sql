ALTER TABLE "project_mail_domain" ADD COLUMN "last_received_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD COLUMN "existing_mx_hosts" jsonb;--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD COLUMN "existing_mx_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD COLUMN "mx_notice_sent_at" timestamp;