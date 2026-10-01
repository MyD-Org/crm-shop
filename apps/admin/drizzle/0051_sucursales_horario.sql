-- Horarios por sucursal (change `horarios-por-sucursal`, rebanada A).
--
-- Cada sucursal tiene su propio horario semanal y sus propias excepciones (feriados, vacaciones,
-- horario especial), con el mismo shape que `tenants.schedule` / `tenants.schedule_exceptions`.
-- Solo ESTRUCTURA y un backfill; cero datos reales (el repo es público).
--
-- - `schedule jsonb NOT NULL DEFAULT '{}'`: '{}' = "sin horario configurado".
-- - `schedule_exceptions jsonb NOT NULL DEFAULT '[]'`.
-- - Backfill: cada sucursal existente hereda el horario y las excepciones de su empresa
--   (`tenants`), con COALESCE para el NULL. Un tenant sin sucursales no cambia. `tenants.*` y
--   `sucursales.horario` (texto libre, deprecado) se conservan intactos.
--
-- GRANT a `shop_app` (el Shop las lee, no las escribe): el SELECT de `sucursales` es POR COLUMNA
-- (0041), así que las columnas nuevas NO se heredan; se conceden de forma explícita. Bloque DO $$
-- condicional como 0041/0050. Si el rol se crea DESPUÉS de esta migración, correr el bloque a mano
-- como owner (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`").
--
-- Drift que vive SOLO en SQL (como 0031/0035/0041/0050): el backfill y el GRANT no están en
-- src/db/schema.ts. El snapshot 0051 solo suma las dos columnas.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   ALTER TABLE "sucursales" DROP COLUMN "schedule", DROP COLUMN "schedule_exceptions";
--   (el GRANT por columna cae con las columnas).

ALTER TABLE "sucursales" ADD COLUMN "schedule" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "sucursales" ADD COLUMN "schedule_exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "sucursales" s
SET "schedule" = COALESCE(t."schedule", '{}'::jsonb),
    "schedule_exceptions" = COALESCE(t."schedule_exceptions", '[]'::jsonb)
FROM "tenants" t
WHERE t."id" = s."tenant_id";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ("schedule", "schedule_exceptions") ON "public"."sucursales" TO shop_app;
  END IF;
END $$;
