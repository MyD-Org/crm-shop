-- Textos del chat del Shop editables desde el admin (Datos → Chat de la tienda).
--
-- `chat_empty_state`: texto del chat vacío. '' = no se cargó: el Shop usa su texto por defecto.
-- `chat_suggestions`: de 0 a 4 preguntas sugeridas (array JSON de strings). '[]' = el Shop usa
-- las suyas por defecto. La validación (largos, cantidad) vive en src/lib/chat-tienda.ts.
--
-- GRANT: el Shop (`shop_app`) lee SÓLO estas dos columnas, además de las que ya tenía (0032).
-- Condicional como en 0032: crm_test y las ramas sin el rol no lo tienen.
-- Drift sólo en SQL: el GRANT (drizzle-kit no lo conoce).
--
-- Reversa (en una migración nueva, SOLO después de revertir el código del Shop que las lee):
--   REVOKE SELECT (chat_empty_state, chat_suggestions) ON public.tenants FROM shop_app;
--   ALTER TABLE public.tenants DROP COLUMN chat_suggestions, DROP COLUMN chat_empty_state;
ALTER TABLE "tenants" ADD COLUMN "chat_empty_state" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "chat_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT (chat_empty_state, chat_suggestions) ON "public"."tenants" TO shop_app;
  END IF;
END $$;
