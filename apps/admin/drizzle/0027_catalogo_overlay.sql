-- Catálogo comercial del Shop, administrado desde el CRM (change `catalogo-shop`, lote L2).
--
-- Alegra sigue siendo fuente de verdad de identidad (alegra_id), stock y precio. Todo el dato
-- comercial —nombre, descripción, categoría propia, tags, orden, visibilidad, fotos— vive acá,
-- en tablas aparte, porque `alegra-sync` hace onConflictDoUpdate sobre TODAS las columnas de
-- catalog_products (incluida images) y pisaría cualquier edición a mano.
--
-- Escrita a mano, como 0014-0025: los snapshots de drizzle-kit quedaron congelados en 0013 y
-- `db:generate` regeneraría todo desde ahí.
--
-- Aditiva: sólo tablas nuevas, sin DROP. Los deploys de Vercel NO corren migraciones drizzle:
-- se aplica a mano contra prod, comparando antes el hash contra __drizzle_migrations.
-- Una reversión del código NUNCA borra estas tablas: contienen trabajo humano de curaduría
-- sobre ~5959 ítems, que es lo único de este cambio que no se recupera con un `git revert`.

-- ── Taxonomía propia de la tienda (hasta 3 niveles) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "shop_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id"),
  -- ON DELETE RESTRICT: borrar una categoría con hijas es un 409 explícito, nunca una cascada
  -- silenciosa ni una fila apuntando a un padre inexistente.
  "parent_id" uuid REFERENCES "shop_categories"("id") ON DELETE RESTRICT,
  "nombre" text NOT NULL,
  "slug" text NOT NULL,
  "orden" integer NOT NULL DEFAULT 0,
  -- Denormalizado para que el tope de 3 niveles sea un CHECK y no un recursivo. La app
  -- garantiza nivel = padre.nivel + 1.
  "nivel" smallint NOT NULL DEFAULT 1,
  "activa" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "shop_categories_nivel_rango" CHECK ("nivel" BETWEEN 1 AND 3),
  CONSTRAINT "shop_categories_slug_formato" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "shop_categories_no_self" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

-- Unicidad de slug entre hermanas. DOS índices parciales y no un UNIQUE (tenant_id, parent_id,
-- slug): en Postgres NULL <> NULL, así que un UNIQUE normal NO impediría dos raíces con el
-- mismo slug. (UNIQUE NULLS NOT DISTINCT existe desde PG15; los parciales andan en cualquiera.)
CREATE UNIQUE INDEX IF NOT EXISTS "shop_categories_slug_raiz_uniq"
  ON "shop_categories" ("tenant_id", "slug") WHERE "parent_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "shop_categories_slug_hijo_uniq"
  ON "shop_categories" ("tenant_id", "parent_id", "slug") WHERE "parent_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "shop_categories_tenant_parent_orden_idx"
  ON "shop_categories" ("tenant_id", "parent_id", "orden");

-- ── Overlay comercial, esparso (sólo los productos que alguien tocó) ───────────────────────

CREATE TABLE IF NOT EXISTS "catalog_overlay" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id"),
  "alegra_id" text NOT NULL,
  -- Fail-closed: nada se publica hasta que alguien lo publique explícitamente.
  "visible" boolean NOT NULL DEFAULT false,
  "nombre" text,
  "descripcion" text,
  "categoria_id" uuid REFERENCES "shop_categories"("id") ON DELETE SET NULL,
  "orden" integer,
  -- [{ url, w, alt? }], ordenado; [0] es la portada.
  "fotos" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" text,

  CONSTRAINT "catalog_overlay_fotos_array" CHECK (jsonb_typeof("fotos") = 'array')
);

-- Sin FK a catalog_products: el overlay puede preceder al espejo (producto nuevo de Alegra).
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_overlay_tenant_alegra_uniq"
  ON "catalog_overlay" ("tenant_id", "alegra_id");

-- Índice del cursor del delta hacia el Shop. El orden de columnas es exactamente el del
-- ORDER BY (updated_at, alegra_id): una masiva escribe centenares de filas con el MISMO
-- updated_at, y sin el desempate el keyset pierde o repite filas.
CREATE INDEX IF NOT EXISTS "catalog_overlay_tenant_updated_idx"
  ON "catalog_overlay" ("tenant_id", "updated_at", "alegra_id");

CREATE INDEX IF NOT EXISTS "catalog_overlay_tenant_categoria_idx"
  ON "catalog_overlay" ("tenant_id", "categoria_id");

-- "Sin foto": el filtro central del flujo de trabajo (publicar por tandas a medida que se
-- fotografía), no un extra.
CREATE INDEX IF NOT EXISTS "catalog_overlay_sin_foto_idx"
  ON "catalog_overlay" ("tenant_id") WHERE jsonb_array_length("fotos") = 0;

-- ── Tags administrables (entidad propia + relación N↔N) ────────────────────────────────────
--
-- NO un text[] por producto: los tags se crean, se renombran, se listan con su conteo de uso y
-- se borran. El uuid es la referencia estable, así que renombrar no toca ninguna fila de
-- producto (y por lo tanto no empuja nada al delta del Shop).
-- Planos: sin parent_id ni nivel — los tags no participan de la jerarquía.

CREATE TABLE IF NOT EXISTS "shop_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL REFERENCES "tenants"("id"),
  "nombre" text NOT NULL,
  "slug" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "shop_tags_slug_formato" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- UNIQUE simple (sin índices parciales, a diferencia de shop_categories): los tags son planos
-- y no hay NULL en la llave.
CREATE UNIQUE INDEX IF NOT EXISTS "shop_tags_slug_uniq" ON "shop_tags" ("tenant_id", "slug");

CREATE TABLE IF NOT EXISTS "catalog_overlay_tags" (
  "overlay_id" uuid NOT NULL REFERENCES "catalog_overlay"("id") ON DELETE CASCADE,
  "tag_id" uuid NOT NULL REFERENCES "shop_tags"("id") ON DELETE CASCADE,
  PRIMARY KEY ("overlay_id", "tag_id")
);

-- Hace baratos el conteo de productos por tag y el filtro por tag.
CREATE INDEX IF NOT EXISTS "cot_tag_idx" ON "catalog_overlay_tags" ("tag_id");

-- ── Frescura del aviso al Shop ─────────────────────────────────────────────────────────────
--
-- El CRM no sabe cuándo sincronizó el Shop: registra su propio último aviso entregado y el
-- panel lo rotula como tal ("Último aviso al Shop entregado: …"), nunca como "la última sync
-- del Shop". Si nunca hubo uno, el panel dice "desconocida".

CREATE TABLE IF NOT EXISTS "shop_sync_ping" (
  "tenant_id" text PRIMARY KEY REFERENCES "tenants"("id"),
  "ultimo_ok_at" timestamptz,
  "ultimo_intento_at" timestamptz
);
