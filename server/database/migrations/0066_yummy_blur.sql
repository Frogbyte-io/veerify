CREATE TABLE "import_tombstone" (
	"project_id" text NOT NULL,
	"entity" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_tombstone" ADD CONSTRAINT "import_tombstone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_tombstone_idx" ON "import_tombstone" USING btree ("project_id","entity","source","external_id");