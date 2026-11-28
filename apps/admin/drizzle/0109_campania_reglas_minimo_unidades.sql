-- Descuento por cantidad en campañas: «A partir de N unidades, X % de descuento». Una regla puede
-- llevar `minimo_unidades` (>= 2): el precio de campaña rige sólo cuando el carrito lleva al menos N
-- unidades alcanzadas por ESA regla (se suman las variantes del modelo y los productos de la marca o
-- categoría). Con menos, el producto sigue a su precio normal. Lo aplica el Shop al cotizar; el
-- catálogo y la ficha muestran el precio normal y el aviso «Llevando N, X % off».
--
-- v1: una regla no puede tener a la vez límite de unidades y mínimo (CHECK): el aviso «Reduzca la
-- cantidad para mantener el precio» del límite contradice al mínimo.
--
-- `calcular_campanias_online` NO cambia (su firma la comparte con el oráculo y su test de
-- paridad). Sólo `aplicar_campanias_online` suma `minimo` a cada entrada de `campanias_online`,
-- leído de la regla elegida. Cuerpo: el de 0095 (su única definición) + el join a la regla.
--
-- Despliegue: aplicar ANTES de mergear. No cargar reglas con mínimo hasta que shop y shop-avantec
-- estén en la versión que lee `minimo`: el Shop anterior lo ignora y daría el descuento con 1 unidad.
--
-- Reversa (SOLO sin reglas con mínimo y después de sacar el código del Shop que lo lee): restaurar
-- aplicar_campanias_online con el cuerpo de 0095; ALTER TABLE campania_reglas DROP CONSTRAINT
-- campania_reglas_minimo_chk; ALTER TABLE campania_reglas DROP COLUMN minimo_unidades.
ALTER TABLE "campania_reglas" ADD COLUMN "minimo_unidades" integer;
--> statement-breakpoint
ALTER TABLE "campania_reglas" ADD CONSTRAINT "campania_reglas_minimo_chk" CHECK ("minimo_unidades" IS NULL OR ("minimo_unidades" >= 2 AND "unidades" IS NULL));
--> statement-breakpoint
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
		         'pct', cc.pct, 'unidades', cc.unidades, 'minimo', r.minimo_unidades,
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
		JOIN campania_reglas r ON r.id = cc.regla_id
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
