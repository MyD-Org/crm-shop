-- Ajuste de coeficiente por producto en las listas de precio online.
--
-- `lista_precio_overrides` admite tipo 'producto' (columna `alegra_id`, el id del producto en el
-- espejo). Precedencia del coeficiente: producto > marca > categoría (la más profunda) > general.
-- Sin FK a catalog_products: si el producto deja de existir el ajuste queda huérfano y no pega con
-- nada (la sync puede borrar/absorber filas y no debe arrastrar ajustes en silencio).
--
-- calcular_precios_online se reescribe (CREATE OR REPLACE, misma firma). origen nuevo:
-- 'producto:<alegra_id>'. aplicar_precios_online no cambia (llama a calcular).
--
-- Drift que vive SOLO en SQL: el CHECK de forma (reemplazado) y la función.
--
-- Reversa (en una migración nueva, SOLO después de sacar el código que lo usa):
--   DELETE FROM lista_precio_overrides WHERE tipo = 'producto';
--   restaurar calcular_precios_online con el cuerpo de 0064 y el CHECK de forma de 0064;
--   DROP INDEX lista_precio_overrides_producto_uniq; ALTER TABLE lista_precio_overrides DROP COLUMN alegra_id;
ALTER TABLE "lista_precio_overrides" ADD COLUMN "alegra_id" text;
--> statement-breakpoint
ALTER TABLE "lista_precio_overrides" DROP CONSTRAINT "lista_precio_overrides_forma_chk";
--> statement-breakpoint
ALTER TABLE "lista_precio_overrides" ADD CONSTRAINT "lista_precio_overrides_forma_chk" CHECK (
	("tipo" = 'marca' AND "marca" IS NOT NULL AND "marca" <> '' AND "marca" = lower(btrim("marca")) AND "categoria_id" IS NULL AND "alegra_id" IS NULL)
	OR ("tipo" = 'categoria' AND "categoria_id" IS NOT NULL AND "marca" IS NULL AND "alegra_id" IS NULL)
	OR ("tipo" = 'producto' AND "alegra_id" IS NOT NULL AND "alegra_id" <> '' AND "marca" IS NULL AND "categoria_id" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lista_precio_overrides_producto_uniq" ON "lista_precio_overrides" USING btree ("lista_id","alegra_id") WHERE "lista_precio_overrides"."tipo" = 'producto';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.calcular_precios_online(p_tenant text, p_ids text[] DEFAULT NULL)
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
	ov_prod AS (
		SELECT b.alegra_id, ov.lista_id, ov.coeficiente
		FROM base b
		JOIN lista_precio_overrides ov ON ov.tenant_id = p_tenant AND ov.tipo = 'producto' AND ov.alegra_id = b.alegra_id
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
	       coalesce(pr.coeficiente, m.coeficiente, c.coeficiente, l.coeficiente) AS coef,
	       CASE WHEN pr.coeficiente IS NOT NULL THEN 'producto:' || b.alegra_id
	            WHEN m.coeficiente IS NOT NULL THEN 'marca:' || m.marca
	            WHEN c.coeficiente IS NOT NULL THEN 'categoria:' || c.cat_id::text
	            ELSE 'general' END AS origen,
	       CASE WHEN b.costo IS NOT NULL AND b.costo > 0
	            THEN round(b.costo * coalesce(pr.coeficiente, m.coeficiente, c.coeficiente, l.coeficiente), 2) END AS precio
	FROM base b
	CROSS JOIN listas l
	LEFT JOIN ov_prod pr ON pr.alegra_id = b.alegra_id AND pr.lista_id = l.id
	LEFT JOIN ov_marca m ON m.alegra_id = b.alegra_id AND m.lista_id = l.id
	LEFT JOIN ov_cat c ON c.alegra_id = b.alegra_id AND c.lista_id = l.id
$fn$;
