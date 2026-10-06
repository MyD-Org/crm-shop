-- Lista privada + enlace con la lista de Alegra + precios privados aparte (change
-- `listas-cuenta-corriente`, rebanada A). Una lista online `privada` solo la ven, en el Shop, los
-- clientes con cuenta corriente cuya lista de Alegra esté enlazada a ella; el público ve el precio
-- de siempre. Aditiva: sin listas privadas ni enlaces el Shop no cambia en nada.
--
-- Contenido:
--  - listas_precio_online.privada (default false). CHECK: una privada no puede ser la referencia.
--    Trigger: una lista con condiciones de medio no puede pasar a privada, y a una privada no se le
--    puede crear/mover una condición de medio.
--  - lista_precio_alegra_mapeo: (tenant, cuenta de Alegra, id de lista de Alegra) -> lista privada.
--    UNIQUE por esa clave; FK compuesta (tenant, lista, privada) -> listas, ON DELETE CASCADE, con
--    CHECK (privada): solo se enlaza una privada del mismo tenant, y una lista con enlaces no puede
--    volver a ser pública sin quitarlos antes (lo hace la operación del admin).
--  - catalog_products.precios_online_privados (jsonb, [{idPriceList,name,price}], sin `main`).
--  - aplicar_precios_online reescrita (CREATE OR REPLACE, misma firma y mismo cálculo): las listas
--    públicas van a precios_online, las privadas a precios_online_privados, en el MISMO recálculo.
--    calcular_precios_online NO cambia (sigue siendo el oráculo de todas las listas activas).
--  - precios_online_cambios.tipo admite 'mapeo' (auditoría de los enlaces).
--  - Vistas para shop_app (el rol NO recibe SELECT sobre catalog_products, listas_precio_online ni el
--    enlace crudo):
--      public.catalog_products_shop_privados (tenant_id, alegra_id, lista_id, precio): un renglón por
--        (ítem activo, lista privada con precio). La vista pública catalog_products_shop NO cambia y
--        ya no recibe privadas porque precios_online deja de contenerlas.
--      public.lista_precio_alegra_mapeo_shop (tenant_id, alegra_account, alegra_price_list_id, lista_id).
--  - GRANT SELECT de las dos vistas a `shop_app` (condicional, patrón 0035/0037/0065), ÚLTIMO statement.
--
-- Despliegue: tras aplicar la migración y desplegar, correr un recálculo masivo ('config') por tenant
-- (Listas -> aplicar cualquier cambio, o `aplicar_precios_online(<tenant>, NULL, 'config')`) para
-- poblar precios_online_privados; hasta entonces las privadas están vacías (el Shop no las usa todavía).
--
-- Drift que vive SOLO en SQL (no está en schema.ts): el CHECK de referencia, el CHECK de privada del
-- enlace, los dos triggers y sus funciones, el CHECK de tipos de precios_online_cambios, la función
-- aplicar_precios_online, las dos vistas y los GRANTs.
--
-- Reversa (en una migración nueva, SOLO después de sacar el código que las usa; nunca editar ésta):
--   DROP VIEW public.lista_precio_alegra_mapeo_shop; DROP VIEW public.catalog_products_shop_privados;
--   restaurar aplicar_precios_online con el cuerpo de 0064 (sin precios_online_privados);
--   DELETE FROM precios_online_cambios WHERE tipo = 'mapeo'; re-crear precios_online_cambios_tipo_chk
--     con los tipos de 0065;
--   DROP TRIGGER listas_precio_online_privada_trg ON listas_precio_online;
--   DROP TRIGGER lista_precio_condiciones_no_privada_trg ON lista_precio_condiciones;
--   DROP FUNCTION public.listas_precio_online_privada_guard(); DROP FUNCTION public.lista_precio_condiciones_no_privada();
--   DROP TABLE lista_precio_alegra_mapeo;
--   ALTER TABLE catalog_products DROP COLUMN precios_online_privados;
--   ALTER TABLE listas_precio_online DROP CONSTRAINT listas_precio_online_privada_ref_chk;
--   DROP INDEX listas_precio_online_tenant_id_privada_uniq; ALTER TABLE listas_precio_online DROP COLUMN privada;
--   (las listas que hoy son privadas pasarían a públicas: despublicarlas antes de revertir).

ALTER TABLE "listas_precio_online" ADD COLUMN "privada" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "listas_precio_online" ADD CONSTRAINT "listas_precio_online_privada_ref_chk" CHECK (NOT "privada" OR NOT "es_referencia");
--> statement-breakpoint
CREATE UNIQUE INDEX "listas_precio_online_tenant_id_privada_uniq" ON "listas_precio_online" USING btree ("tenant_id","id","privada");
--> statement-breakpoint
CREATE TABLE "lista_precio_alegra_mapeo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"alegra_account" text NOT NULL,
	"alegra_price_list_id" text NOT NULL,
	"lista_id" uuid NOT NULL,
	"privada" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lista_precio_alegra_mapeo_privada_chk" CHECK ("privada")
);
--> statement-breakpoint
ALTER TABLE "lista_precio_alegra_mapeo" ADD CONSTRAINT "lista_precio_alegra_mapeo_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lista_precio_alegra_mapeo" ADD CONSTRAINT "lista_precio_alegra_mapeo_lista_fk" FOREIGN KEY ("tenant_id","lista_id","privada") REFERENCES "public"."listas_precio_online"("tenant_id","id","privada") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "lista_precio_alegra_mapeo_uniq" ON "lista_precio_alegra_mapeo" USING btree ("tenant_id","alegra_account","alegra_price_list_id");
--> statement-breakpoint
CREATE INDEX "lista_precio_alegra_mapeo_lista_idx" ON "lista_precio_alegra_mapeo" USING btree ("lista_id");
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "precios_online_privados" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE FUNCTION public.lista_precio_condiciones_no_privada() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	IF EXISTS (SELECT 1 FROM listas_precio_online l WHERE l.id = NEW.lista_id AND l.privada) THEN
		RAISE EXCEPTION 'Una lista privada no puede enlazarse a un medio de pago.' USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END
$fn$;
--> statement-breakpoint
CREATE TRIGGER lista_precio_condiciones_no_privada_trg
BEFORE INSERT OR UPDATE OF lista_id ON lista_precio_condiciones
FOR EACH ROW EXECUTE FUNCTION public.lista_precio_condiciones_no_privada();
--> statement-breakpoint
CREATE FUNCTION public.listas_precio_online_privada_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	IF NEW.privada AND NOT OLD.privada
	   AND EXISTS (SELECT 1 FROM lista_precio_condiciones c WHERE c.lista_id = NEW.id) THEN
		RAISE EXCEPTION 'Una lista enlazada a un medio de pago no puede ser privada.' USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END
$fn$;
--> statement-breakpoint
CREATE TRIGGER listas_precio_online_privada_trg
BEFORE UPDATE OF privada ON listas_precio_online
FOR EACH ROW EXECUTE FUNCTION public.listas_precio_online_privada_guard();
--> statement-breakpoint
ALTER TABLE "precios_online_cambios" DROP CONSTRAINT "precios_online_cambios_tipo_chk";
--> statement-breakpoint
ALTER TABLE "precios_online_cambios" ADD CONSTRAINT "precios_online_cambios_tipo_chk" CHECK ("tipo" IN ('lista_alta','lista_edicion','lista_baja','referencia','override_alta','override_edicion','override_baja','umbral','condicion','revertir','costo_aprobado','costo_rechazado','mapeo'));
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

	RETURN QUERY SELECT v_act, v_ret;
END
$fn$;
--> statement-breakpoint
CREATE VIEW "public"."catalog_products_shop_privados" AS
SELECT p.tenant_id,
       p.alegra_id,
       (e->>'idPriceList')::uuid AS lista_id,
       (e->>'price')::numeric AS precio
FROM "public"."catalog_products" p
CROSS JOIN LATERAL jsonb_array_elements(p.precios_online_privados) e
WHERE p.status = 'active' AND coalesce(p.alegra_status, 'active') <> 'inactive';
--> statement-breakpoint
CREATE VIEW "public"."lista_precio_alegra_mapeo_shop" AS
SELECT tenant_id,
       alegra_account,
       alegra_price_list_id,
       lista_id
FROM "public"."lista_precio_alegra_mapeo";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."catalog_products_shop_privados" TO shop_app;
    GRANT SELECT ON "public"."lista_precio_alegra_mapeo_shop" TO shop_app;
  END IF;
END $$;
