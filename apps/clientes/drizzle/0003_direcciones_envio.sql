CREATE TABLE "shop"."direcciones_envio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"etiqueta" text,
	"calle" text NOT NULL,
	"ciudad" text NOT NULL,
	"provincia" text,
	"cp" text,
	"referencias" text,
	"predeterminada" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dir_envio_tenant_usuario" ON "shop"."direcciones_envio" USING btree ("tenant_id","clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dir_envio_una_predeterminada" ON "shop"."direcciones_envio" USING btree ("tenant_id","clerk_user_id") WHERE "shop"."direcciones_envio"."predeterminada";