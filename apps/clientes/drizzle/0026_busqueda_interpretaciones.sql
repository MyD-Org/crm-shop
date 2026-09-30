-- Caché de la búsqueda inteligente del catálogo (spec catálogo asistido, platform 2026-09-29; flag
-- `busqueda-ia`, apagado por defecto). ADITIVA: una tabla nueva; nada existente cambia.
--
-- Guarda qué se entendió de una consulta del buscador (`resultado` = { aplicar, sugerir }: nombres
-- de categoría e ids de atributos) para no volver a llamar a Jev por la misma consulta, y alimenta
-- las "Búsquedas frecuentes" del buscador (más `hits` en 30 días, con resultado no vacío).
--   - Clave (tenant_id, consulta_norm, arbol_hash): consulta normalizada (minúsculas, sin tildes,
--     hasta 120 caracteres) y hash del árbol de categorías activo del tenant.
--   - Nunca se guardan consultas que parecen email o teléfono: se descartan antes de interpretar.
--   - El código la usa envuelta: si esta migración todavía no corrió (o la tabla falla), la
--     búsqueda sigue igual, sin caché. Por eso el código puede desplegarse antes que la migración.
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta):
--   DROP TABLE "shop"."busqueda_interpretaciones";
CREATE TABLE "shop"."busqueda_interpretaciones" (
	"tenant_id" text NOT NULL,
	"consulta_norm" text NOT NULL,
	"arbol_hash" text NOT NULL,
	"resultado" jsonb NOT NULL,
	"fuente" text NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bi_pk" PRIMARY KEY("tenant_id","consulta_norm","arbol_hash"),
	CONSTRAINT "bi_largos" CHECK (char_length("shop"."busqueda_interpretaciones"."consulta_norm") <= 120 and char_length("shop"."busqueda_interpretaciones"."arbol_hash") <= 64)
);
--> statement-breakpoint
CREATE INDEX "bi_tenant_uso" ON "shop"."busqueda_interpretaciones" USING btree ("tenant_id","last_used_at");
--> statement-breakpoint
-- Los DEFAULT PRIVILEGES del esquema `shop` ya le dan acceso a `shop_app` si la tabla la crea el
-- rol dueño (el de MIGRATE_DATABASE_URL). El GRANT explícito es cinturón (patrón 0016). Sin
-- DELETE: el Shop no borra interpretaciones. Condicional: las bases sin el rol no lo tienen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "shop"."busqueda_interpretaciones" TO shop_app;
  END IF;
END $$;
