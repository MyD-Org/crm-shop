-- Campañas de precios (spec apps/admin/docs/superpowers/specs/2026-10-28-campanias-precios-design.md).
--
-- Va después de la 0094 (venta sin stock, crm-shop#695, ya en staging). Su par del Shop es la 0040
-- (`order_items` con la campaña); correr ésta primero.
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
-- aplicar_campanias_online materializa catalog_products.campanias_online; aplicar_precios_online
-- (cuerpo de 0068) la llama al final, así la sync de costos y los ajustes también la recalculan.
-- El Shop lee la columna por catalog_products_shop (agregada AL FINAL) y la ventana por
-- campanias_shop; nunca las tablas.
--
-- Reversa (en una migración nueva, SOLO después de sacar el código del Shop que lo usa):
--   DROP VIEW campanias_shop; DROP VIEW catalog_products_shop + CREATE VIEW con el SELECT de 0083 y
--   su bloque GRANT; restaurar aplicar_precios_online con el cuerpo de 0068 y el CHECK de tipo de
--   0068; DROP FUNCTION aplicar_campanias_online(text, text[]); DROP FUNCTION
--   calcular_campanias_online(text, text[]); ALTER TABLE catalog_products DROP COLUMN
--   campanias_online; DROP TABLE campania_reglas; DROP TABLE campanias.
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

--> statement-breakpoint
-- Escribe catalog_products.campanias_online: por cada campaña que alcanza al producto, el precio de
-- cada lista PÚBLICA de precios_online con el descuento (round al centavo, neto sin IVA). Un
-- producto sin precios públicos no recibe entrada (nunca un precio de campaña <= 0). Mismo lock que
-- aplicar_precios_online (pg_advisory_xact_lock es reentrante en la misma transacción).
CREATE OR REPLACE FUNCTION public.aplicar_campanias_online(p_tenant text, p_ids text[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
	v_act integer := 0;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtext('precios_online:' || p_tenant));

	WITH calc AS (
		SELECT * FROM calcular_campanias_online(p_tenant, p_ids)
	), entradas AS (
		SELECT cc.alegra_id, c.inicio,
		       jsonb_build_object(
		         'id', c.id, 'reglaId', cc.regla_id, 'inicio', c.inicio, 'fin', c.fin,
		         'pct', cc.pct, 'unidades', cc.unidades,
		         'precios', (
		           SELECT jsonb_agg(jsonb_build_object(
		                    'idPriceList', e->>'idPriceList',
		                    'price', round((e->>'price')::numeric * (100 - cc.pct) / 100, 2))
		                  ORDER BY ord)
		           FROM jsonb_array_elements(p.precios_online) WITH ORDINALITY AS x(e, ord)
		           WHERE (e->>'price')::numeric > 0
		         )
		       ) AS entrada
		FROM calc cc
		JOIN campanias c ON c.id = cc.campania_id
		JOIN catalog_products p ON p.tenant_id = p_tenant AND p.alegra_id = cc.alegra_id
		WHERE jsonb_typeof(p.precios_online) = 'array'
		  AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.precios_online) e WHERE (e->>'price')::numeric > 0)
	), nuevo AS (
		SELECT en.alegra_id, jsonb_agg(en.entrada ORDER BY en.inicio, en.entrada->>'id') AS lista
		FROM entradas en
		GROUP BY en.alegra_id
	), destino AS (
		SELECT p0.id, n.lista
		FROM catalog_products p0
		LEFT JOIN nuevo n ON n.alegra_id = p0.alegra_id
		WHERE p0.tenant_id = p_tenant AND (p_ids IS NULL OR p0.alegra_id = ANY (p_ids))
	)
	UPDATE catalog_products p
	SET campanias_online = d.lista
	FROM destino d
	WHERE p.id = d.id AND p.campanias_online IS DISTINCT FROM d.lista;
	GET DIAGNOSTICS v_act = ROW_COUNT;

	RETURN v_act;
END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aplicar_precios_online(p_tenant text, p_ids text[] DEFAULT NULL, p_modo text DEFAULT 'config')
RETURNS TABLE (actualizados integer, retenidos integer)
LANGUAGE plpgsql AS $fn$
DECLARE
	v_umbral numeric;
	v_ret integer := 0;
	v_act integer := 0;
BEGIN
	IF p_modo NOT IN ('config', 'costo') THEN
		RAISE EXCEPTION 'modo invalido: %', p_modo;
	END IF;
	-- Un solo escritor de precios por tenant a la vez (la vista previa, el aplicar, la sync y el webhook).
	PERFORM pg_advisory_xact_lock(hashtext('precios_online:' || p_tenant));

	IF p_modo = 'costo' THEN
		SELECT coalesce((SELECT c.umbral_retencion_pct FROM precios_online_config c WHERE c.tenant_id = p_tenant), 10)
		INTO v_umbral;

		-- to_regclass y no DROP ... IF EXISTS: éste emite un NOTICE en cada llamada (ruido en los logs).
		IF to_regclass('pg_temp._po_cand') IS NOT NULL THEN
			DROP TABLE _po_cand;
		END IF;
		CREATE TEMP TABLE _po_cand ON COMMIT DROP AS
		SELECT p.id, p.alegra_id, p.costo, p.costo_aplicado,
		       CASE
		         WHEN p.costo_aplicado IS NULL OR p.costo_aplicado <= 0 THEN false
		         WHEN p.costo IS NULL OR p.costo <= 0 THEN true
		         ELSE abs(p.costo - p.costo_aplicado) / p.costo_aplicado * 100 > v_umbral
		       END AS retener,
		       CASE
		         WHEN p.costo_aplicado IS NULL OR p.costo_aplicado <= 0 THEN NULL
		         WHEN p.costo IS NULL OR p.costo <= 0 THEN NULL
		         ELSE round(abs(p.costo - p.costo_aplicado) / p.costo_aplicado * 100, 2)
		       END AS variacion
		FROM catalog_products p
		WHERE p.tenant_id = p_tenant
		  AND (p_ids IS NULL OR p.alegra_id = ANY (p_ids))
		  AND p.costo IS DISTINCT FROM p.costo_aplicado;

		-- Retener: queda el precio vigente y el costo propuesto pendiente. Un costo ya rechazado no reabre.
		INSERT INTO precios_online_retenciones (tenant_id, alegra_id, costo_vigente, costo_propuesto, variacion_pct)
		SELECT p_tenant, c.alegra_id, c.costo_aplicado, c.costo, c.variacion
		FROM _po_cand c
		WHERE c.retener
		  AND NOT EXISTS (
		    SELECT 1 FROM precios_online_retenciones r
		    WHERE r.tenant_id = p_tenant AND r.alegra_id = c.alegra_id AND r.estado = 'rechazada'
		      AND r.costo_propuesto IS NOT DISTINCT FROM c.costo
		  )
		ON CONFLICT (tenant_id, alegra_id) WHERE estado = 'pendiente' DO UPDATE SET
		  costo_vigente = excluded.costo_vigente,
		  costo_propuesto = excluded.costo_propuesto,
		  variacion_pct = excluded.variacion_pct;
		GET DIAGNOSTICS v_ret = ROW_COUNT;

		-- Aplicar: el costo nuevo pasa a ser el vigente.
		UPDATE catalog_products p SET costo_aplicado = c.costo
		FROM _po_cand c WHERE p.id = c.id AND NOT c.retener;

		-- Un retenido cuyo costo volvió dentro del umbral (o al valor vigente) se resuelve solo.
		UPDATE precios_online_retenciones r SET estado = 'resuelta', resuelto_at = now(), resuelto_por = 'sistema'
		FROM catalog_products p
		WHERE r.tenant_id = p_tenant AND r.estado = 'pendiente'
		  AND p.tenant_id = p_tenant AND p.alegra_id = r.alegra_id
		  AND (p_ids IS NULL OR p.alegra_id = ANY (p_ids))
		  AND p.costo IS NOT DISTINCT FROM p.costo_aplicado;
	END IF;

	-- 0068: las listas PRIVADAS no entran a precios_online (lo lee shop_app por la vista pública):
	-- van a precios_online_privados, sin `main`. Un solo recálculo escribe las dos columnas.
	WITH nuevo AS (
		SELECT c.alegra_id,
		       coalesce(jsonb_agg(jsonb_build_object('idPriceList', c.lista_id, 'name', l.nombre, 'price', c.precio, 'main', l.es_referencia)
		                          ORDER BY l.orden, l.nombre) FILTER (WHERE c.precio IS NOT NULL AND NOT l.privada), '[]'::jsonb) AS lista,
		       coalesce(jsonb_agg(jsonb_build_object('idPriceList', c.lista_id, 'name', l.nombre, 'price', c.precio)
		                          ORDER BY l.orden, l.nombre) FILTER (WHERE c.precio IS NOT NULL AND l.privada), '[]'::jsonb) AS privadas,
		       max(c.precio) FILTER (WHERE l.es_referencia) AS ref
		FROM calcular_precios_online(p_tenant, p_ids) c
		JOIN listas_precio_online l ON l.id = c.lista_id
		GROUP BY c.alegra_id
	), destino AS (
		SELECT p0.id, coalesce(n.lista, '[]'::jsonb) AS lista, coalesce(n.privadas, '[]'::jsonb) AS privadas, n.ref
		FROM catalog_products p0
		LEFT JOIN nuevo n ON n.alegra_id = p0.alegra_id
		WHERE p0.tenant_id = p_tenant AND (p_ids IS NULL OR p0.alegra_id = ANY (p_ids))
	)
	UPDATE catalog_products p
	SET precios_online = d.lista, precios_online_privados = d.privadas, precio_online_ref = d.ref, precios_online_at = now()
	FROM destino d
	WHERE p.id = d.id AND (p.precios_online IS DISTINCT FROM d.lista
	                       OR p.precios_online_privados IS DISTINCT FROM d.privadas
	                       OR p.precio_online_ref IS DISTINCT FROM d.ref);
	GET DIAGNOSTICS v_act = ROW_COUNT;

	-- 0095: el precio de campaña depende del normal: se recalcula en el mismo paso (mismo lock).
	PERFORM aplicar_campanias_online(p_tenant, p_ids);

	RETURN QUERY SELECT v_act, v_ret;
END
$fn$;
--> statement-breakpoint
ALTER TABLE "precios_online_cambios" DROP CONSTRAINT "precios_online_cambios_tipo_chk";
--> statement-breakpoint
ALTER TABLE "precios_online_cambios" ADD CONSTRAINT "precios_online_cambios_tipo_chk" CHECK ("tipo" IN ('lista_alta','lista_edicion','lista_baja','referencia','override_alta','override_edicion','override_baja','umbral','condicion','revertir','costo_aprobado','costo_rechazado','mapeo','campania'));
--> statement-breakpoint
-- Lo que el Shop lee de las campañas: las no terminadas o terminadas hace menos de 24 h (recotizar
-- un pedido pendiente creado durante la campaña). Sin las reglas: el Shop sólo necesita la ventana.
CREATE VIEW "public"."campanias_shop" AS
SELECT tenant_id, id, nombre, etiqueta, inicio, fin
FROM "public"."campanias"
WHERE fin > now() - interval '24 hours';
--> statement-breakpoint
-- catalog_products_shop: el SELECT de 0083 + campanias_online AL FINAL (CREATE OR REPLACE sólo
-- admite agregar columnas al final). Aplicar en prod ANTES de mergear el Shop que la declara.
CREATE OR REPLACE VIEW "public"."catalog_products_shop" AS
SELECT tenant_id,
       alegra_id,
       stock,
       precios_online AS precios_alegra,
       (status = 'active' AND coalesce(alegra_status, 'active') <> 'inactive' AND tipo <> 'padre') AS activo,
       alegra_leido_at,
       name,
       description,
       code,
       brand,
       category_alegra_id,
       iva_porcentaje,
       tipo,
       grupo_id,
       etiqueta,
       es_representante,
       coalesce(grupo_id, alegra_id) AS overlay_alegra_id,
       campanias_online
FROM "public"."catalog_products";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."catalog_products_shop" TO shop_app;
    GRANT SELECT ON "public"."campanias_shop" TO shop_app;
  END IF;
END $$;
