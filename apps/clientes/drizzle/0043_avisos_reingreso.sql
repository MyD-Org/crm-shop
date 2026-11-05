-- Avisos de reingreso, change `aviso-reingreso` (rebanada S1).
--
-- Una persona deja su email en un producto/variante agotado y un cron le manda UN mail cuando el
-- disponible vuelve a ser mayor que 0. Pendiente = avisado_at y unsubscribed_at NULL; el único parcial
-- `avisos_pendiente_uq` impide dos pendientes del mismo (tenant, producto, email sin importar
-- mayúsculas). WhatsApp solo con consentimiento (CHECK). Sin IP ni user agent.
--
-- El código del Shop que la escribe sale detrás del flag `aviso-reingreso`: aplicar esta migración en
-- staging y prod ANTES del merge del código (un código adelantado al esquema rompe la ficha).
--
-- Reversa (a mano, SOLO después de revertir el código del Shop que la escribe), en una migración
-- nueva, append-only; nunca editar ésta:
--   DROP TABLE "shop"."avisos_reingreso";
CREATE TABLE "shop"."avisos_reingreso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"alegra_id" text NOT NULL,
	"email" text NOT NULL,
	"whatsapp" text,
	"cantidad" integer DEFAULT 1 NOT NULL,
	"quiere_encargar" boolean DEFAULT false NOT NULL,
	"consentimiento_contacto" boolean DEFAULT false NOT NULL,
	"clerk_user_id" text,
	"token_baja" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"avisando_en" timestamp with time zone,
	"intentos" integer DEFAULT 0 NOT NULL,
	"avisado_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"email_error" text,
	CONSTRAINT "avisos_cantidad" CHECK ("shop"."avisos_reingreso"."cantidad" between 1 and 999),
	CONSTRAINT "avisos_largos" CHECK (char_length("shop"."avisos_reingreso"."email") <= 254 and char_length(coalesce("shop"."avisos_reingreso"."whatsapp", '')) <= 40 and char_length("shop"."avisos_reingreso"."alegra_id") <= 64),
	CONSTRAINT "avisos_whatsapp_consentimiento" CHECK ("shop"."avisos_reingreso"."whatsapp" is null or "shop"."avisos_reingreso"."consentimiento_contacto")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "avisos_token_baja_uq" ON "shop"."avisos_reingreso" USING btree ("token_baja");--> statement-breakpoint
CREATE UNIQUE INDEX "avisos_pendiente_uq" ON "shop"."avisos_reingreso" USING btree ("tenant_id","alegra_id",lower("email")) WHERE "shop"."avisos_reingreso"."avisado_at" is null and "shop"."avisos_reingreso"."unsubscribed_at" is null;--> statement-breakpoint
CREATE INDEX "avisos_pendientes_idx" ON "shop"."avisos_reingreso" USING btree ("tenant_id","alegra_id") WHERE "shop"."avisos_reingreso"."avisado_at" is null and "shop"."avisos_reingreso"."unsubscribed_at" is null;--> statement-breakpoint
CREATE INDEX "avisos_email_pendientes_idx" ON "shop"."avisos_reingreso" USING btree ("tenant_id",lower("email")) WHERE "shop"."avisos_reingreso"."avisado_at" is null and "shop"."avisos_reingreso"."unsubscribed_at" is null;
--> statement-breakpoint
-- Los DEFAULT PRIVILEGES del esquema `shop` ya le dan acceso a `shop_app` si la tabla la crea el rol
-- dueño; el GRANT explícito es cinturón por si la creó otro rol (patrón 0016). Con DELETE: la purga de
-- retención (180 días) borra filas. Condicional: las bases sin el rol no lo tienen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "shop"."avisos_reingreso" TO shop_app;
  END IF;
END $$;
