-- GRANTs del Shop sobre el overlay del catálogo, registrados en una migración.
--
-- El Shop (apps/clientes, rol de runtime `shop_app`) lee dos TABLAS de `public` que ninguna
-- migración le concedía: en prod el SELECT se dio a mano, así que una base nueva (una rama de
-- Neon, un entorno recreado) quedaba sin él y el catálogo del Shop fallaba con 42501.
--   - public.catalog_overlay  (overlay comercial por producto: visible, nombre, categoría, fotos)
--   - public.shop_categories  (árbol de categorías propio de la tienda)
-- Relevamiento de todo lo que el Shop lee de `public` (apps/clientes/src/db/crm.ts, el fixture
-- crm-contrato.json y SQL crudo en apps/clientes/src): el resto ya tenía GRANT en 0031, 0032,
-- 0034, 0035, 0036 o 0037. Éstas dos eran las únicas sin migración.
--
-- Sólo SELECT: el Shop no escribe el overlay (lo edita el admin del CRM). Tabla completa y no por
-- columna porque el Shop no lee nada sensible de ellas (son datos que publica la tienda).
--
-- Idempotente: GRANT sobre un permiso ya concedido no hace nada. En prod es un no-op (el permiso
-- ya existe). En crm_test y en las ramas sin el rol no concede nada (bloque condicional, como
-- 0035/0037). Si el rol se crea DESPUÉS de esta migración, correr este bloque a mano como owner
-- (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`").
--
-- Drift que vive SOLO en SQL (como 0031/0032/0034/0035/0037): los GRANTs no están en
-- src/db/schema.ts. El snapshot 0038 es igual al 0037.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura del overlay; nunca
-- editar ésta):
--   REVOKE SELECT ON public.catalog_overlay FROM shop_app;
--   REVOKE SELECT ON public.shop_categories FROM shop_app;
-- (USAGE sobre el esquema lo siguen necesitando las vistas de 0031–0037: no se revoca.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."catalog_overlay" TO shop_app;
    GRANT SELECT ON "public"."shop_categories" TO shop_app;
  END IF;
END $$;
