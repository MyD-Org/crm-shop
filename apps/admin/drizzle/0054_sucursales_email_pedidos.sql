-- Aviso de pedido nuevo al local (change `aviso-pedido-nuevo-operador`, rebanada A).
--
-- Cada sucursal puede tener su propio email donde el Shop avisa los pedidos nuevos. Solo
-- ESTRUCTURA; cero datos reales (el repo es público): el valor se carga desde Admin → Sucursales.
--
-- - `email_pedidos text NULL`: NULL = sin destinatario propio; el Shop cae a
--   `tenants.receipts_email` y, si tampoco hay, no manda nada.
--
-- GRANT a `shop_app` (el Shop la lee, no la escribe): el SELECT de `sucursales` es POR COLUMNA
-- (0041), así que la columna nueva NO se hereda; se concede de forma explícita. Bloque DO $$
-- condicional como 0041/0050/0051. Si el rol se crea DESPUÉS de esta migración, correr el bloque
-- a mano como owner (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`").
--
-- Drift que vive SOLO en SQL (como 0031/0035/0041/0050/0051): el GRANT no está en
-- src/db/schema.ts. El snapshot 0054 solo suma la columna.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   ALTER TABLE "sucursales" DROP COLUMN "email_pedidos";
--   (el GRANT por columna cae con la columna).

ALTER TABLE "sucursales" ADD COLUMN "email_pedidos" text;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ("email_pedidos") ON "public"."sucursales" TO shop_app;
  END IF;
END $$;
