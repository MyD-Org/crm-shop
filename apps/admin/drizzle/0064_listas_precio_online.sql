-- Listas de precio online (change `listas-precio-online`, rebanada B): precio = costo x coeficiente,
-- definido en el admin. Las listas de precio de Alegra NUNCA participan del cálculo.
--
-- Aditiva y SIN efecto en el Shop: no cambia la vista `catalog_products_shop` (eso es la rebanada C)
-- ni da ningún GRANT a `shop_app`. `precios_online` queda en '[]' hasta que alguien cree listas y
-- aplique el cambio desde el admin.
--
-- Contenido:
--  - 5 tablas: listas_precio_online, lista_precio_overrides, precios_online_config,
--    precios_online_cambios (historial) y precios_online_retenciones.
--  - 3 columnas en catalog_products: precios_online (jsonb, mismo shape que los precios del Shop:
--    [{idPriceList,name,price,main}]), precio_online_ref (precio de la lista de referencia, para
--    ordenar/filtrar) y precios_online_at; 2 índices.
--  - 2 funciones SQL, UNA sola implementación del cálculo (la usan el recálculo masivo, el de un
--    ítem suelto, la vista previa y la grilla):
--      calcular_precios_online(tenant, ids)         STABLE, no escribe. Neto sin IVA:
--        round(costo_aplicado x coef_efectivo, 2) (half-up para positivos). Precedencia del
--        coeficiente: override de marca > override de categoría (la MÁS PROFUNDA entre las
--        categorías del producto y sus ancestros; empate = mayor coeficiente) > general de la lista.
--        costo NULL o <= 0 => precio NULL (nunca 0). NO lee precios_alegra ni prices.
--      aplicar_precios_online(tenant, ids, modo)    escribe solo las filas que difieren.
--        modo 'config': recalcula con el costo_aplicado vigente.
--        modo 'costo' : antes decide, por ítem, si el costo nuevo (catalog_products.costo) se aplica
--        (costo_aplicado := costo) o se RETIENE (variación > umbral_retencion_pct; caer a NULL/0
--        también retiene); un retenido queda en precios_online_retenciones. Ambos umbrales actúan
--        solo al SUPERAR el número (igual no dispara).
--
-- Drift que vive SOLO en SQL (no está en schema.ts): los CHECK (coeficiente >= 1, forma de los
-- overrides, estados y tipos) y las dos funciones. `precios_online_cambios.objeto` (no está en el
-- diseño original) identifica el objeto del cambio para revertir solo la última entrada vigente.
--
-- Reversa (en una migración nueva, SOLO después de sacar el código que las usa; nunca editar ésta):
--   DROP FUNCTION public.aplicar_precios_online(text, text[], text);
--   DROP FUNCTION public.calcular_precios_online(text, text[]);
--   DROP INDEX "cp_tenant_sin_costo"; DROP INDEX "cp_tenant_precio_ref";
--   ALTER TABLE "catalog_products" DROP COLUMN "precios_online_at", DROP COLUMN "precio_online_ref", DROP COLUMN "precios_online";
--   DROP TABLE "precios_online_retenciones", "precios_online_cambios", "precios_online_config",
--     "lista_precio_overrides", "listas_precio_online";

CREATE TABLE "listas_precio_online" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"nombre" text NOT NULL,
	"coeficiente" numeric(7, 4) NOT NULL,
	"es_referencia" boolean DEFAULT false NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listas_precio_online_coef_chk" CHECK ("coeficiente" >= 1),
	CONSTRAINT "listas_precio_online_ref_activa_chk" CHECK (NOT "es_referencia" OR "activa")
);
--> statement-breakpoint
ALTER TABLE "listas_precio_online" ADD CONSTRAINT "listas_precio_online_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "listas_precio_online_nombre_uniq" ON "listas_precio_online" USING btree ("tenant_id",lower("nombre"));
--> statement-breakpoint
CREATE UNIQUE INDEX "listas_precio_online_ref_uniq" ON "listas_precio_online" USING btree ("tenant_id") WHERE "listas_precio_online"."es_referencia";
--> statement-breakpoint
CREATE TABLE "lista_precio_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"lista_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"marca" text,
	"categoria_id" uuid,
	"coeficiente" numeric(7, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lista_precio_overrides_coef_chk" CHECK ("coeficiente" >= 1),
	CONSTRAINT "lista_precio_overrides_forma_chk" CHECK (
		("tipo" = 'marca' AND "marca" IS NOT NULL AND "marca" <> '' AND "marca" = lower(btrim("marca")) AND "categoria_id" IS NULL)
		OR ("tipo" = 'categoria' AND "categoria_id" IS NOT NULL AND "marca" IS NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "lista_precio_overrides" ADD CONSTRAINT "lista_precio_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lista_precio_overrides" ADD CONSTRAINT "lista_precio_overrides_lista_id_listas_precio_online_id_fk" FOREIGN KEY ("lista_id") REFERENCES "public"."listas_precio_online"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lista_precio_overrides" ADD CONSTRAINT "lista_precio_overrides_categoria_id_shop_categories_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."shop_categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "lista_precio_overrides_marca_uniq" ON "lista_precio_overrides" USING btree ("lista_id","marca") WHERE "lista_precio_overrides"."tipo" = 'marca';
--> statement-breakpoint
CREATE UNIQUE INDEX "lista_precio_overrides_categoria_uniq" ON "lista_precio_overrides" USING btree ("lista_id","categoria_id") WHERE "lista_precio_overrides"."tipo" = 'categoria';
--> statement-breakpoint
CREATE INDEX "lista_precio_overrides_tenant_idx" ON "lista_precio_overrides" USING btree ("tenant_id","tipo");
--> statement-breakpoint
CREATE TABLE "precios_online_config" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"umbral_confirmacion_pct" numeric(5, 2) DEFAULT '20' NOT NULL,
	"umbral_retencion_pct" numeric(5, 2) DEFAULT '10' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "precios_online_config_umbrales_chk" CHECK ("umbral_confirmacion_pct" > 0 AND "umbral_retencion_pct" > 0)
);
--> statement-breakpoint
ALTER TABLE "precios_online_config" ADD CONSTRAINT "precios_online_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "precios_online_cambios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"tipo" text NOT NULL,
	"objeto" text NOT NULL,
	"lista_id" uuid,
	"antes" jsonb,
	"despues" jsonb,
	"resumen" jsonb,
	"usuario" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revertido_de" uuid,
	"version_config" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "precios_online_cambios_tipo_chk" CHECK ("tipo" IN ('lista_alta','lista_edicion','lista_baja','referencia','override_alta','override_edicion','override_baja','umbral','revertir','costo_aprobado','costo_rechazado'))
);
--> statement-breakpoint
ALTER TABLE "precios_online_cambios" ADD CONSTRAINT "precios_online_cambios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "precios_online_cambios_tenant_idx" ON "precios_online_cambios" USING btree ("tenant_id","creado_at");
--> statement-breakpoint
CREATE INDEX "precios_online_cambios_objeto_idx" ON "precios_online_cambios" USING btree ("tenant_id","objeto","creado_at");
--> statement-breakpoint
CREATE TABLE "precios_online_retenciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"alegra_id" text NOT NULL,
	"costo_vigente" numeric(14, 4),
	"costo_propuesto" numeric(14, 4),
	"variacion_pct" numeric(9, 2),
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelto_at" timestamp with time zone,
	"resuelto_por" text,
	CONSTRAINT "precios_online_retenciones_estado_chk" CHECK ("estado" IN ('pendiente','aprobada','rechazada','resuelta'))
);
--> statement-breakpoint
ALTER TABLE "precios_online_retenciones" ADD CONSTRAINT "precios_online_retenciones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "precios_online_retenciones_pendiente_uniq" ON "precios_online_retenciones" USING btree ("tenant_id","alegra_id") WHERE "precios_online_retenciones"."estado" = 'pendiente';
--> statement-breakpoint
CREATE INDEX "precios_online_retenciones_alegra_idx" ON "precios_online_retenciones" USING btree ("tenant_id","alegra_id","estado");
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "precios_online" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "precio_online_ref" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "precios_online_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "cp_tenant_precio_ref" ON "catalog_products" USING btree ("tenant_id","precio_online_ref");
--> statement-breakpoint
CREATE INDEX "cp_tenant_sin_costo" ON "catalog_products" USING btree ("tenant_id") WHERE "catalog_products"."costo" IS NULL;
--> statement-breakpoint
CREATE FUNCTION public.calcular_precios_online(p_tenant text, p_ids text[] DEFAULT NULL)
RETURNS TABLE (alegra_id text, lista_id uuid, costo_base numeric, coef numeric, origen text, precio numeric)
LANGUAGE sql STABLE AS $fn$
	WITH RECURSIVE base AS (
		SELECT p.alegra_id, p.costo_aplicado AS costo,
		       nullif(lower(btrim(p.brand)), '') AS marca, o.categoria_id
		FROM catalog_products p
		LEFT JOIN catalog_overlay o ON o.tenant_id = p.tenant_id AND o.alegra_id = p.alegra_id
		WHERE p.tenant_id = p_tenant AND (p_ids IS NULL OR p.alegra_id = ANY (p_ids))
	),
	-- La categoría del producto y todos sus ancestros (UNION y no UNION ALL: corta cualquier ciclo).
	anc AS (
		SELECT b.alegra_id, c.id AS cat_id, c.parent_id, c.nivel
		FROM base b JOIN shop_categories c ON c.id = b.categoria_id AND c.tenant_id = p_tenant
		UNION
		SELECT a.alegra_id, c.id, c.parent_id, c.nivel
		FROM anc a JOIN shop_categories c ON c.id = a.parent_id AND c.tenant_id = p_tenant
	),
	listas AS (
		SELECT l.id, l.coeficiente FROM listas_precio_online l WHERE l.tenant_id = p_tenant AND l.activa
	),
	ov_marca AS (
		SELECT b.alegra_id, ov.lista_id, ov.coeficiente, ov.marca
		FROM base b
		JOIN lista_precio_overrides ov ON ov.tenant_id = p_tenant AND ov.tipo = 'marca' AND ov.marca = b.marca
	),
	-- Un override de categoría por (producto, lista): el de la categoría más profunda; empate = mayor coef.
	ov_cat AS (
		SELECT DISTINCT ON (a.alegra_id, ov.lista_id) a.alegra_id, ov.lista_id, ov.coeficiente, a.cat_id
		FROM anc a
		JOIN lista_precio_overrides ov ON ov.tenant_id = p_tenant AND ov.tipo = 'categoria' AND ov.categoria_id = a.cat_id
		ORDER BY a.alegra_id, ov.lista_id, a.nivel DESC, ov.coeficiente DESC, a.cat_id
	)
	SELECT b.alegra_id, l.id AS lista_id, b.costo AS costo_base,
	       coalesce(m.coeficiente, c.coeficiente, l.coeficiente) AS coef,
	       CASE WHEN m.coeficiente IS NOT NULL THEN 'marca:' || m.marca
	            WHEN c.coeficiente IS NOT NULL THEN 'categoria:' || c.cat_id::text
	            ELSE 'general' END AS origen,
	       CASE WHEN b.costo IS NOT NULL AND b.costo > 0
	            THEN round(b.costo * coalesce(m.coeficiente, c.coeficiente, l.coeficiente), 2) END AS precio
	FROM base b
	CROSS JOIN listas l
	LEFT JOIN ov_marca m ON m.alegra_id = b.alegra_id AND m.lista_id = l.id
	LEFT JOIN ov_cat c ON c.alegra_id = b.alegra_id AND c.lista_id = l.id
$fn$;
--> statement-breakpoint
CREATE FUNCTION public.aplicar_precios_online(p_tenant text, p_ids text[] DEFAULT NULL, p_modo text DEFAULT 'config')
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

		DROP TABLE IF EXISTS _po_cand;
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

	WITH nuevo AS (
		SELECT c.alegra_id,
		       coalesce(jsonb_agg(jsonb_build_object('idPriceList', c.lista_id, 'name', l.nombre, 'price', c.precio, 'main', l.es_referencia)
		                          ORDER BY l.orden, l.nombre) FILTER (WHERE c.precio IS NOT NULL), '[]'::jsonb) AS lista,
		       max(c.precio) FILTER (WHERE l.es_referencia) AS ref
		FROM calcular_precios_online(p_tenant, p_ids) c
		JOIN listas_precio_online l ON l.id = c.lista_id
		GROUP BY c.alegra_id
	), destino AS (
		SELECT p0.id, coalesce(n.lista, '[]'::jsonb) AS lista, n.ref
		FROM catalog_products p0
		LEFT JOIN nuevo n ON n.alegra_id = p0.alegra_id
		WHERE p0.tenant_id = p_tenant AND (p_ids IS NULL OR p0.alegra_id = ANY (p_ids))
	)
	UPDATE catalog_products p
	SET precios_online = d.lista, precio_online_ref = d.ref, precios_online_at = now()
	FROM destino d
	WHERE p.id = d.id AND (p.precios_online IS DISTINCT FROM d.lista OR p.precio_online_ref IS DISTINCT FROM d.ref);
	GET DIAGNOSTICS v_act = ROW_COUNT;

	RETURN QUERY SELECT v_act, v_ret;
END
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calcular_precios_online(text, text[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.aplicar_precios_online(text, text[], text) FROM PUBLIC;
