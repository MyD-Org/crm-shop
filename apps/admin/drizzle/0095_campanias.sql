-- Campañas de precios (spec apps/admin/docs/superpowers/specs/2026-10-28-campanias-precios-design.md).
--
-- Una campaña es un % de descuento con nombre y ventana horaria que se aplica ENCIMA del precio
-- online normal sin modificarlo. Reglas por producto (alcanza a todo el modelo), marca o categoría
-- (la del overlay del ancla del modelo y sus ancestros). Precedencia: producto > marca > categoría
-- más profunda. Un % de 0 excluye.
--
-- calcular_campanias_online: qué regla de qué campaña alcanza a cada producto (campañas no
-- terminadas hace más de 24 h: la gracia de un pedido pendiente). Lo contrasta con el oráculo
-- src/lib/campanias-oraculo.ts el test test/integration/campanias-calculo.integration.test.ts.
--
-- Drift que vive SOLO en SQL: los CHECK de forma, de pct y de unidades, y las funciones.
--
-- Reversa (en una migración nueva, SOLO después de sacar el código que lo usa):
--   DROP FUNCTION calcular_campanias_online(text, text[]);
--   DROP TABLE campania_reglas; DROP TABLE campanias;
CREATE TABLE "campanias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"nombre" text NOT NULL,
	"etiqueta" text NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fin" timestamp with time zone NOT NULL,
	"creado_por" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campanias_ventana_chk" CHECK ("fin" > "inicio")
);
--> statement-breakpoint
ALTER TABLE "campanias" ADD CONSTRAINT "campanias_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "campanias_tenant_fin_idx" ON "campanias" USING btree ("tenant_id","fin");
--> statement-breakpoint
CREATE TABLE "campania_reglas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"campania_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"alegra_id" text,
	"marca" text,
	"categoria_id" uuid,
	"pct" smallint NOT NULL,
	"unidades" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campania_reglas_pct_chk" CHECK ("pct" BETWEEN 0 AND 90),
	CONSTRAINT "campania_reglas_unidades_chk" CHECK ("unidades" IS NULL OR ("unidades" >= 1 AND "tipo" = 'producto')),
	CONSTRAINT "campania_reglas_forma_chk" CHECK (
		("tipo" = 'marca' AND "marca" IS NOT NULL AND "marca" <> '' AND "marca" = lower(btrim("marca")) AND "categoria_id" IS NULL AND "alegra_id" IS NULL)
		OR ("tipo" = 'categoria' AND "categoria_id" IS NOT NULL AND "marca" IS NULL AND "alegra_id" IS NULL)
		OR ("tipo" = 'producto' AND "alegra_id" IS NOT NULL AND "alegra_id" <> '' AND "marca" IS NULL AND "categoria_id" IS NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "campania_reglas" ADD CONSTRAINT "campania_reglas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campania_reglas" ADD CONSTRAINT "campania_reglas_campania_id_campanias_id_fk" FOREIGN KEY ("campania_id") REFERENCES "public"."campanias"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campania_reglas" ADD CONSTRAINT "campania_reglas_categoria_id_shop_categories_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."shop_categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "campania_reglas_producto_uniq" ON "campania_reglas" USING btree ("campania_id","alegra_id") WHERE "campania_reglas"."tipo" = 'producto';
--> statement-breakpoint
CREATE UNIQUE INDEX "campania_reglas_marca_uniq" ON "campania_reglas" USING btree ("campania_id","marca") WHERE "campania_reglas"."tipo" = 'marca';
--> statement-breakpoint
CREATE UNIQUE INDEX "campania_reglas_categoria_uniq" ON "campania_reglas" USING btree ("campania_id","categoria_id") WHERE "campania_reglas"."tipo" = 'categoria';
--> statement-breakpoint
CREATE INDEX "campania_reglas_tenant_tipo_idx" ON "campania_reglas" USING btree ("tenant_id","tipo");
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "campanias_online" jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.calcular_campanias_online(p_tenant text, p_ids text[] DEFAULT NULL)
RETURNS TABLE (alegra_id text, campania_id uuid, regla_id uuid, pct smallint, unidades integer)
LANGUAGE sql STABLE AS $fn$
	WITH RECURSIVE base AS (
		SELECT p.alegra_id, coalesce(p.grupo_id, p.alegra_id) AS g, nullif(lower(btrim(p.brand)), '') AS marca
		FROM catalog_products p
		WHERE p.tenant_id = p_tenant AND (p_ids IS NULL OR p.alegra_id = ANY (p_ids))
	),
	-- La categoría es la del overlay del ANCLA del modelo (mismo criterio que el Shop: overlay por
	-- coalesce(grupo_id, alegra_id)), más todos sus ancestros (UNION: corta cualquier ciclo).
	anc AS (
		SELECT b.alegra_id, c.id AS cat_id, c.parent_id, c.nivel
		FROM base b
		JOIN catalog_overlay o ON o.tenant_id = p_tenant AND o.alegra_id = b.g
		JOIN shop_categories c ON c.id = o.categoria_id AND c.tenant_id = p_tenant
		UNION
		SELECT a.alegra_id, c.id, c.parent_id, c.nivel
		FROM anc a JOIN shop_categories c ON c.id = a.parent_id AND c.tenant_id = p_tenant
	),
	camp AS (
		SELECT c.id FROM campanias c WHERE c.tenant_id = p_tenant AND c.fin > now() - interval '24 hours'
	),
	-- Producto: la regla de cualquier producto del mismo modelo; primero la del propio producto,
	-- después mayor %, después menor id de regla.
	r_prod AS (
		SELECT DISTINCT ON (b.alegra_id, r.campania_id) b.alegra_id, r.campania_id, r.id AS regla_id, r.pct, r.unidades
		FROM base b
		JOIN catalog_products rp ON rp.tenant_id = p_tenant AND coalesce(rp.grupo_id, rp.alegra_id) = b.g
		JOIN campania_reglas r ON r.tenant_id = p_tenant AND r.tipo = 'producto' AND r.alegra_id = rp.alegra_id
		JOIN camp ON camp.id = r.campania_id
		ORDER BY b.alegra_id, r.campania_id, (r.alegra_id = b.alegra_id) DESC, r.pct DESC, r.id
	),
	r_marca AS (
		SELECT b.alegra_id, r.campania_id, r.id AS regla_id, r.pct, r.unidades
		FROM base b
		JOIN campania_reglas r ON r.tenant_id = p_tenant AND r.tipo = 'marca' AND r.marca = b.marca
		JOIN camp ON camp.id = r.campania_id
	),
	-- Categoría: la más profunda; empate de nivel = mayor %, después menor id de categoría.
	r_cat AS (
		SELECT DISTINCT ON (a.alegra_id, r.campania_id) a.alegra_id, r.campania_id, r.id AS regla_id, r.pct, r.unidades
		FROM anc a
		JOIN campania_reglas r ON r.tenant_id = p_tenant AND r.tipo = 'categoria' AND r.categoria_id = a.cat_id
		JOIN camp ON camp.id = r.campania_id
		ORDER BY a.alegra_id, r.campania_id, a.nivel DESC, r.pct DESC, a.cat_id
	),
	pares AS (
		SELECT x.alegra_id, x.campania_id FROM r_prod x
		UNION SELECT x.alegra_id, x.campania_id FROM r_marca x
		UNION SELECT x.alegra_id, x.campania_id FROM r_cat x
	),
	elegida AS (
		SELECT pa.alegra_id, pa.campania_id,
		       CASE WHEN rp.regla_id IS NOT NULL THEN rp.regla_id WHEN rm.regla_id IS NOT NULL THEN rm.regla_id ELSE rc.regla_id END AS regla_id,
		       CASE WHEN rp.regla_id IS NOT NULL THEN rp.pct WHEN rm.regla_id IS NOT NULL THEN rm.pct ELSE rc.pct END AS pct,
		       CASE WHEN rp.regla_id IS NOT NULL THEN rp.unidades WHEN rm.regla_id IS NOT NULL THEN rm.unidades ELSE rc.unidades END AS unidades
		FROM pares pa
		LEFT JOIN r_prod rp ON rp.alegra_id = pa.alegra_id AND rp.campania_id = pa.campania_id
		LEFT JOIN r_marca rm ON rm.alegra_id = pa.alegra_id AND rm.campania_id = pa.campania_id
		LEFT JOIN r_cat rc ON rc.alegra_id = pa.alegra_id AND rc.campania_id = pa.campania_id
	)
	SELECT e.alegra_id, e.campania_id, e.regla_id, e.pct, e.unidades
	FROM elegida e
	WHERE e.pct > 0
$fn$;
