-- Espejo del catálogo comercial que administra el CRM (contrato catalogo-overlay/v1).
--
-- El Shop NO consulta al CRM para renderizar: copia una vez por día (o cuando el CRM avisa) y
-- después lee siempre de estas tablas. Si el CRM se cae, la tienda sigue sirviendo la última
-- copia buena.
--
-- Mono-tenant, igual que el resto del Shop: el tenant es SHOP_TENANT_ID y no se guarda por fila.
-- Los ids son los del CRM y se conservan tal cual: son la llave del reemplazo atómico.

-- Taxonomía propia. Viaja ENTERA y se reemplaza de una: no hay merge parcial.
CREATE TABLE IF NOT EXISTS "shop_categories" (
  "id" uuid PRIMARY KEY,
  "parent_id" uuid,
  "nombre" text NOT NULL,
  "slug" text NOT NULL,
  "orden" integer DEFAULT 0 NOT NULL,
  "nivel" smallint DEFAULT 1 NOT NULL,
  "activa" boolean DEFAULT true NOT NULL,
  -- URL completa, ya compuesta por el CRM. El Shop no conoce su layout de keys ni su dominio.
  "imagen" text
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_categories_parent_idx" ON "shop_categories" ("parent_id", "orden");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_categories_slug_idx" ON "shop_categories" ("slug");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shop_tags" (
  "id" uuid PRIMARY KEY,
  "nombre" text NOT NULL,
  "slug" text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_tags_slug_idx" ON "shop_tags" ("slug");--> statement-breakpoint

-- Overlay por producto. ESPARSO: sólo hay fila para los productos que alguien tocó en el CRM.
-- La ausencia de fila equivale a todos los defaults, y `visible` es false: nada se publica solo.
CREATE TABLE IF NOT EXISTS "catalog_overlay" (
  "alegra_id" text PRIMARY KEY,
  "visible" boolean DEFAULT false NOT NULL,
  "nombre" text,
  "descripcion" text,
  "categoria_id" uuid,
  "orden" integer,
  "tag_ids" uuid[] DEFAULT '{}' NOT NULL,
  -- [{ url, w, alt? }] con la url ya compuesta por el CRM.
  "fotos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- El del CRM, con MICROSEGUNDOS: es el cursor del delta y no puede truncarse.
  "updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_overlay_visible_idx" ON "catalog_overlay" ("visible");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_overlay_categoria_idx" ON "catalog_overlay" ("categoria_id");--> statement-breakpoint

-- Estado de la sincronización. Una sola fila. Guarda el cursor del delta y el último error, con
-- la misma regla de "última copia buena" que cuotas: un fallo NO borra lo que ya se copió.
CREATE TABLE IF NOT EXISTS "catalogo_sync_state" (
  "tenant" text PRIMARY KEY,
  -- Cursor keyset del contrato: hasta dónde llegó el delta.
  "cursor_updated_at" text,
  "cursor_alegra_id" text,
  "taxonomia_fetched_at" timestamp with time zone,
  "overlay_fetched_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "last_error" text
);
