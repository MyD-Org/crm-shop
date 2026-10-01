-- Envío configurable desde el CRM (change `envio-gratis-configurable`, rebanada A).
--
-- Solo ESTRUCTURA y defaults conservadores: cero datos reales. Se edita en el admin (sección
-- "Envíos", grupo Datos); el repo es público.
--
-- Extiende `reglas_venta` (UNA fila por tenant) con dos interruptores independientes:
-- - `envio_domicilio_activo` (default true): el envío a domicilio se ofrece ("costo a coordinar").
-- - `envio_gratis_activo` (default false): interruptor explícito. Sólo con true aplican alcance y
--   mínimo. Al migrar queda APAGADO y sin alcance ni mínimo hasta que la empresa lo configure.
-- - `envio_gratis_alcance` ('pais' | 'provincias'; NULL = sin configurar).
-- - `envio_gratis_provincias text[]` (claves de provincia, como `zonas.provincia_clave`).
-- - `envio_gratis_minimo_modo` ('sin_minimo' | 'desde'; NULL = sin configurar).
-- - `envio_gratis_minimo numeric(12,2)` (sin impuestos; sólo con modo 'desde').
-- Los NULL significan SOLO "sin configurar": el CHECK final impide encender el envío gratis sin
-- alcance y modo (y sin monto con 'desde'), así nunca "vacío = todo". Apagar el gratis conserva lo
-- cargado. Provincias vacías con alcance 'provincias' y gratis activo = nunca gratis (válido).
--
-- GRANT a `shop_app`: el SELECT de tabla de 0045 ya cubre las columnas nuevas; el bloque DO $$ es
-- idempotente y deja la intención registrada. Si el rol se crea DESPUÉS de esta migración, correr
-- el bloque a mano como owner (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`").
--
-- Drift que vive SOLO en SQL (como 0031/0035/0041/0045): los 4 CHECK y el GRANT no están en
-- src/db/schema.ts. El snapshot 0050 solo suma las columnas.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   ALTER TABLE "reglas_venta" DROP COLUMN "envio_domicilio_activo", DROP COLUMN "envio_gratis_activo",
--   DROP COLUMN "envio_gratis_alcance", DROP COLUMN "envio_gratis_provincias",
--   DROP COLUMN "envio_gratis_minimo_modo", DROP COLUMN "envio_gratis_minimo";
--   (los CHECK caen con las columnas).

ALTER TABLE "reglas_venta" ADD COLUMN "envio_domicilio_activo" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD COLUMN "envio_gratis_activo" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD COLUMN "envio_gratis_alcance" text;
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD COLUMN "envio_gratis_provincias" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD COLUMN "envio_gratis_minimo_modo" text;
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD COLUMN "envio_gratis_minimo" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD CONSTRAINT "reglas_venta_envio_alcance_check" CHECK ("envio_gratis_alcance" IS NULL OR "envio_gratis_alcance" IN ('pais', 'provincias'));
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD CONSTRAINT "reglas_venta_envio_minimo_modo_check" CHECK ("envio_gratis_minimo_modo" IS NULL OR "envio_gratis_minimo_modo" IN ('sin_minimo', 'desde'));
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD CONSTRAINT "reglas_venta_envio_minimo_check" CHECK ("envio_gratis_minimo" IS NULL OR "envio_gratis_minimo" > 0);
--> statement-breakpoint
ALTER TABLE "reglas_venta" ADD CONSTRAINT "reglas_venta_envio_gratis_configurado_check" CHECK ("envio_gratis_activo" = false OR ("envio_gratis_alcance" IS NOT NULL AND "envio_gratis_minimo_modo" IS NOT NULL AND ("envio_gratis_minimo_modo" = 'sin_minimo' OR "envio_gratis_minimo" IS NOT NULL)));
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."reglas_venta" TO shop_app;
  END IF;
END $$;
