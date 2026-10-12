-- Variantes de producto en el espejo (change `variantes-de-producto`, rebanada S2 `espejo-variantes`).
--
-- Alegra modela un producto con opciones como un PADRE (`type: variantParent`, no se vende) y sus
-- HIJOS (`type: variant`, ítems reales con id, precio, stock y código propios; traen `idItemParent`
-- y `variantAttributes`). Esta migración le da al espejo dónde guardar eso.
--
-- Columnas nuevas en `catalog_products` (todas aditivas: nullable o con default):
--   tipo             'simple' (default) | 'padre' | 'variante'   (CHECK `catalog_products_tipo_chk`, solo en SQL)
--   padre_alegra_id  variantes: id del padre (principal = id de Alegra; solo-secundaria = `<slug>:<id>`)
--   variante         jsonb [{"atributo":"Color","opcion":"Verde"}]
--   variante_clave   clave normalizada de la opción (opciones en minúscula, sin tildes, ordenadas, unidas con '|')
--   grupo_id         el grupo (modelo): el padre, o el ancla de un grupo manual. NULL = se vende suelta
--   etiqueta         texto del selector de la variante (opciones unidas con ' / ')
--   es_representante la variante que da la cara del modelo en el listado (default true)
-- tipo / padre_alegra_id / variante / variante_clave son "columnas de Alegra" (las escribe el upsert del
-- espejo con frescura por fila). grupo_id / etiqueta / es_representante son DERIVADAS: las calcula
-- `recalcularGrupos` (lib/catalogo-variantes-repo.ts); el upsert no las toca.
-- Índices parciales: cp_tenant_grupo (tenant_id, grupo_id) y cp_tenant_padre (tenant_id, padre_alegra_id).
--
-- Backfill SIN llamar a Alegra, desde `raw` (idempotente: cada UPDATE sólo toca filas que todavía no
-- tienen el dato, así que reaplicar no pisa lo que la sync ya escribió):
--   - tipo / padre: raw->>'type' ('variantParent' → padre, 'variant' → variante) y raw->'idItemParent'
--     (en las filas con `cuenta_id` se antepone `<slug>:` para que coincida con el id sintético).
--   - variante: raw->'variantAttributes' (primera opción de cada atributo) si Alegra la entregó; las filas
--     guardadas con `fields=inventory` NO la traen (verificado contra Alegra, 2026-10-11), así que se
--     deriva del nombre: lo que sigue a '<nombre del padre> / ' o, si no, al último ' / '. La próxima
--     sync escribe la opción real de Alegra.
--   - variante_clave, etiqueta y grupo_id (sólo si existe la fila del padre).
-- Usa `unaccent` (la extensión que ya usan las búsquedas del catálogo).
-- `es_representante` queda en true para todos: lo fija `scripts/variantes-recalcular.ts --ejecutar`
-- (o la próxima sync). Es requisito antes de prender el flag `variantes-selector`.
--
-- Aplicar en staging y prod ANTES de mergear el código que selecciona estas columnas (drizzle selecciona
-- columnas explícitas: el código adelantado al schema tira el bot y la tienda). El código viejo funciona
-- con el schema nuevo.
--
-- Drift que vive SOLO en SQL (no está en src/db/schema.ts): el CHECK de `tipo`.
--
-- Reversa (en una migración nueva, SOLO después de sacar el código que las usa; nunca editar ésta):
--   DROP INDEX IF EXISTS "cp_tenant_grupo"; DROP INDEX IF EXISTS "cp_tenant_padre";
--   ALTER TABLE "catalog_products" DROP CONSTRAINT IF EXISTS "catalog_products_tipo_chk",
--     DROP COLUMN "tipo", DROP COLUMN "padre_alegra_id", DROP COLUMN "variante", DROP COLUMN "variante_clave",
--     DROP COLUMN "grupo_id", DROP COLUMN "etiqueta", DROP COLUMN "es_representante";
--   (antes, revertir 0081: la vista usa `tipo`.)

ALTER TABLE "catalog_products"
  ADD COLUMN IF NOT EXISTS "tipo" text DEFAULT 'simple' NOT NULL,
  ADD COLUMN IF NOT EXISTS "padre_alegra_id" text,
  ADD COLUMN IF NOT EXISTS "variante" jsonb,
  ADD COLUMN IF NOT EXISTS "variante_clave" text,
  ADD COLUMN IF NOT EXISTS "grupo_id" text,
  ADD COLUMN IF NOT EXISTS "etiqueta" text,
  ADD COLUMN IF NOT EXISTS "es_representante" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_products_tipo_chk') THEN
    ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_tipo_chk" CHECK ("tipo" IN ('simple', 'padre', 'variante'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_tenant_grupo" ON "catalog_products" USING btree ("tenant_id","grupo_id") WHERE "grupo_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_tenant_padre" ON "catalog_products" USING btree ("tenant_id","padre_alegra_id") WHERE "padre_alegra_id" is not null;
--> statement-breakpoint
-- Backfill 1: tipo desde raw.type.
UPDATE "catalog_products"
SET "tipo" = CASE lower(btrim("raw"->>'type')) WHEN 'variantparent' THEN 'padre' ELSE 'variante' END
WHERE "tipo" = 'simple'
  AND "raw" IS NOT NULL
  AND lower(btrim("raw"->>'type')) IN ('variantparent', 'variant');
--> statement-breakpoint
-- Backfill 2: padre de las variantes (idItemParent puede venir como número, texto u objeto {id}).
UPDATE "catalog_products" p
SET "padre_alegra_id" = CASE
  WHEN p."cuenta_id" IS NOT NULL THEN (SELECT c."slug" FROM "alegra_cuentas" c WHERE c."id" = p."cuenta_id") || ':' || x."id_padre"
  ELSE x."id_padre"
END
FROM (
  SELECT "id", nullif(btrim(coalesce("raw"->'idItemParent'->>'id', "raw"->>'idItemParent')), '') AS "id_padre"
  FROM "catalog_products"
  WHERE "tipo" = 'variante' AND "padre_alegra_id" IS NULL AND "raw" IS NOT NULL
) x
WHERE p."id" = x."id"
  AND x."id_padre" IS NOT NULL
  AND (p."cuenta_id" IS NULL OR EXISTS (SELECT 1 FROM "alegra_cuentas" c WHERE c."id" = p."cuenta_id"));
--> statement-breakpoint
-- Backfill 3: opción desde variantAttributes (la primera opción de cada atributo, en el orden de Alegra).
UPDATE "catalog_products" p
SET "variante" = a."v"
FROM (
  SELECT p2."id",
         jsonb_agg(
           jsonb_build_object(
             'atributo', coalesce(nullif(btrim(t."e"->>'name'), ''), 'Opción'),
             'opcion', btrim(t."e"->'options'->0->>'value')
           ) ORDER BY t."ord"
         ) AS "v"
  FROM "catalog_products" p2
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p2."raw"->'variantAttributes') = 'array' THEN p2."raw"->'variantAttributes' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS t("e", "ord")
  WHERE p2."tipo" = 'variante' AND p2."variante" IS NULL
    AND coalesce(btrim(t."e"->'options'->0->>'value'), '') <> ''
  GROUP BY p2."id"
) a
WHERE p."id" = a."id";
--> statement-breakpoint
-- Backfill 4: las que Alegra no entregó se derivan del nombre ("Modelo / Verde" → Verde).
UPDATE "catalog_products" p
SET "variante" = jsonb_build_array(jsonb_build_object('atributo', 'Opción', 'opcion', s."opcion"))
FROM (
  SELECT c."id",
         CASE
           WHEN pa."nombre" IS NOT NULL AND left(btrim(c."name"), length(pa."nombre") + 3) = pa."nombre" || ' / '
             THEN btrim(substr(btrim(c."name"), length(pa."nombre") + 4))
           ELSE btrim(coalesce(substring(btrim(c."name") from '^.* / (.*)$'), ''))
         END AS "opcion"
  FROM "catalog_products" c
  LEFT JOIN (SELECT "tenant_id", "alegra_id", btrim("name") AS "nombre" FROM "catalog_products") pa
    ON pa."tenant_id" = c."tenant_id" AND pa."alegra_id" = c."padre_alegra_id"
  WHERE c."tipo" = 'variante' AND c."variante" IS NULL
) s
WHERE p."id" = s."id" AND s."opcion" <> '';
--> statement-breakpoint
-- Backfill 5: clave normalizada (mismo criterio que normalizarCodigo en TS: sin tildes, minúsculas,
-- espacios colapsados; ordenada por bytes y unida con '|').
UPDATE "catalog_products" p
SET "variante_clave" = k."clave"
FROM (
  SELECT p2."id",
         string_agg(x."o", '|' ORDER BY x."o" COLLATE "C") AS "clave"
  FROM "catalog_products" p2
  CROSS JOIN LATERAL (
    SELECT lower(unaccent(regexp_replace(btrim(e->>'opcion'), '\s+', ' ', 'g'))) AS "o"
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p2."variante") = 'array' THEN p2."variante" ELSE '[]'::jsonb END) e
  ) x
  WHERE p2."tipo" = 'variante' AND p2."variante" IS NOT NULL AND p2."variante_clave" IS NULL AND x."o" <> ''
  GROUP BY p2."id"
) k
WHERE p."id" = k."id";
--> statement-breakpoint
-- Backfill 6: etiqueta (opciones unidas con ' / ').
UPDATE "catalog_products" p
SET "etiqueta" = k."etiqueta"
FROM (
  SELECT p2."id",
         string_agg(btrim(e."e"->>'opcion'), ' / ' ORDER BY e."ord") AS "etiqueta"
  FROM "catalog_products" p2
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p2."variante") = 'array' THEN p2."variante" ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS e("e", "ord")
  WHERE p2."tipo" = 'variante' AND p2."variante" IS NOT NULL AND p2."etiqueta" IS NULL
    AND coalesce(btrim(e."e"->>'opcion'), '') <> ''
  GROUP BY p2."id"
) k
WHERE p."id" = k."id";
--> statement-breakpoint
-- Backfill 7: grupo = el padre, sólo si la fila del padre existe en el espejo del mismo tenant.
UPDATE "catalog_products" p
SET "grupo_id" = p."padre_alegra_id"
WHERE p."tipo" = 'variante'
  AND p."grupo_id" IS NULL
  AND p."padre_alegra_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "catalog_products" pa
    WHERE pa."tenant_id" = p."tenant_id" AND pa."alegra_id" = p."padre_alegra_id" AND pa."tipo" = 'padre'
  );
