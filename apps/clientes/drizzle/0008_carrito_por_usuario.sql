CREATE TABLE "shop"."carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_version_check" CHECK ("shop"."carts"."version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cart_tenant_usuario" ON "shop"."carts" USING btree ("tenant_id","clerk_user_id");