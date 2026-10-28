CREATE TABLE "device_authorization" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"client_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"interval" integer DEFAULT 5 NOT NULL,
	"last_polled_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"approved_at" timestamp,
	"redeemed_at" timestamp,
	"issued_key_id" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "device_authorization_device_code_hash_unique" UNIQUE("device_code_hash"),
	CONSTRAINT "device_authorization_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
ALTER TABLE "user_api_key" ADD COLUMN "created_via" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_authorization" ADD CONSTRAINT "device_authorization_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authorization" ADD CONSTRAINT "device_authorization_issued_key_id_user_api_key_id_fk" FOREIGN KEY ("issued_key_id") REFERENCES "public"."user_api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_authorization_expires_idx" ON "device_authorization" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "device_authorization_user_idx" ON "device_authorization" USING btree ("user_id");