CREATE TABLE "shop"."favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"alegra_item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fav_tenant_usuario_item" ON "shop"."favorites" USING btree ("tenant_id","clerk_user_id","alegra_item_id");--> statement-breakpoint
CREATE INDEX "fav_tenant_usuario_fecha" ON "shop"."favorites" USING btree ("tenant_id","clerk_user_id","created_at");