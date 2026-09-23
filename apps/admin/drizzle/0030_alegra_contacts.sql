CREATE TABLE "alegra_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"alegra_account" text DEFAULT 'principal' NOT NULL,
	"alegra_id" text NOT NULL,
	"name" text NOT NULL,
	"identification" text,
	"identification_norm" text,
	"email" text,
	"emails_norm" text[] DEFAULT '{}'::text[] NOT NULL,
	"phone_primary" text,
	"phone_secondary" text,
	"mobile" text,
	"phones_norm" text[] DEFAULT '{}'::text[] NOT NULL,
	"types" text[] DEFAULT '{}'::text[] NOT NULL,
	"price_list_id" text,
	"price_list_name" text,
	"price_list_status" text,
	"seller_id" text,
	"seller_name" text,
	"payment_term_id" text,
	"payment_term_name" text,
	"payment_term_days" integer,
	"credit_limit" numeric(16, 2),
	"tipo_cuenta" text GENERATED ALWAYS AS (CASE WHEN coalesce("payment_term_days",0) > 0 OR coalesce("credit_limit",0) > 0 THEN 'corriente' ELSE 'contado' END) STORED,
	"alegra_status" text,
	"status" text DEFAULT 'active' NOT NULL,
	"origen" text DEFAULT 'sync' NOT NULL,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alegra_contacts_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"alegra_account" text DEFAULT 'principal' NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"contacts_synced" integer DEFAULT 0 NOT NULL,
	"marked_inactive" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "alegra_contacts" ADD CONSTRAINT "alegra_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alegra_contacts_sync_log" ADD CONSTRAINT "alegra_contacts_sync_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ac_tenant_cuenta_alegra" ON "alegra_contacts" USING btree ("tenant_id","alegra_account","alegra_id");--> statement-breakpoint
CREATE INDEX "ac_tenant_ident" ON "alegra_contacts" USING btree ("tenant_id","identification_norm") WHERE "identification_norm" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ac_emails_gin" ON "alegra_contacts" USING gin ("emails_norm");--> statement-breakpoint
CREATE INDEX "ac_phones_gin" ON "alegra_contacts" USING gin ("phones_norm");--> statement-breakpoint
CREATE INDEX "acsl_tenant_started" ON "alegra_contacts_sync_log" USING btree ("tenant_id","started_at");