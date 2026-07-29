CREATE TABLE "catalog_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alegra_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_alegra_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alegra_id" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"category_alegra_id" text,
	"brand" text,
	"prices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stock" numeric,
	"status" text DEFAULT 'active' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"items_synced" integer DEFAULT 0 NOT NULL,
	"categories_synced" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cc_alegra_id" ON "catalog_categories" USING btree ("alegra_id");--> statement-breakpoint
CREATE INDEX "cc_status_name" ON "catalog_categories" USING btree ("status","name");--> statement-breakpoint
CREATE UNIQUE INDEX "cp_alegra_id" ON "catalog_products" USING btree ("alegra_id");--> statement-breakpoint
CREATE INDEX "cp_code" ON "catalog_products" USING btree ("code");--> statement-breakpoint
CREATE INDEX "cp_category" ON "catalog_products" USING btree ("category_alegra_id");--> statement-breakpoint
CREATE INDEX "cp_status_name" ON "catalog_products" USING btree ("status","name");--> statement-breakpoint
CREATE INDEX "csl_started" ON "catalog_sync_log" USING btree ("started_at");