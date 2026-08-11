CREATE TABLE "client_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"alegra_contact_id" text NOT NULL,
	"razon_social" text,
	"cuit" text,
	"id_price_list" text,
	"tipo_cuenta" text,
	"estado" text DEFAULT 'activa' NOT NULL,
	"metodo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "link_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"alegra_contact_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"destino_masked" text NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cl_user_activa" ON "client_links" USING btree ("clerk_user_id") WHERE "client_links"."estado" = 'activa';--> statement-breakpoint
CREATE INDEX "cl_contacto" ON "client_links" USING btree ("alegra_contact_id");--> statement-breakpoint
CREATE INDEX "lo_user" ON "link_otps" USING btree ("clerk_user_id","created_at");--> statement-breakpoint
CREATE INDEX "lo_expira" ON "link_otps" USING btree ("expires_at");