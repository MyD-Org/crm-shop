-- Permisos por sección (change `permisos-por-seccion`, slice S1). Aditiva e idempotente: dos
-- columnas nullable, sin default ni backfill. NULL = default del rol (comportamiento previo).
-- Ver lib/secciones.ts.
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "secciones_permitidas" text[];--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "ver_costos" boolean;
