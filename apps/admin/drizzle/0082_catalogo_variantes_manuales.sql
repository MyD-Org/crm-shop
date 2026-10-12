-- Grupos de variantes armados a mano (change `variantes-de-producto`, rebanada S4).
--
-- Caso real: el "RGB" de un modelo es OTRO producto de Alegra (otro precio, otro código), pero en
-- la tienda tiene que aparecer como una opción más del modelo. Alegra no lo sabe, así que lo arma el
-- operador desde el panel de catálogo y queda acá.
--
-- Una fila = "este producto pertenece al grupo `grupo_id`, con esta etiqueta". `grupo_id` es el
-- `alegra_id` del ANCLA del grupo: un padre de Alegra, o un producto suelto que el operador eligió
-- como base (en ese caso el ancla también tiene su propia fila, con `grupo_id = alegra_id`). El grupo
-- efectivo de un producto es coalesce(esta tabla, padre de Alegra) y lo materializa
-- `recalcularGrupos` (lib/catalogo-variantes-repo.ts) en `catalog_products.grupo_id`.
--
-- Un producto pertenece a UN solo grupo: la clave primaria (tenant_id, alegra_id) lo garantiza.
-- Que el ancla exista, que no sea un padre ni una variante de otro grupo y que no haya ciclos lo
-- valida la ruta /api/admin/catalogo/variantes (no hay CHECK ni FK a catalog_products: el espejo se
-- reescribe y un producto puede desaparecer entre corridas; en ese caso `recalcularGrupos` ignora la
-- fila huérfana).
--
-- Sin GRANT: la tabla es del CRM. El Shop la lee a través de `catalog_products_shop` (la vista corre
-- con los privilegios de su dueño) cuando se sume la columna de grupo (rebanada S5a).
--
-- Drift sólo en SQL: ninguno (la tabla, la clave y el índice están en schema.ts). La creación es
-- idempotente (IF NOT EXISTS) para poder reaplicarla.
--
-- Reversa (en una migración nueva, SOLO después de revertir el código que la lee):
--   DROP TABLE "public"."catalog_variantes_manuales";
CREATE TABLE IF NOT EXISTS "catalog_variantes_manuales" (
	"tenant_id" text NOT NULL,
	"alegra_id" text NOT NULL,
	"grupo_id" text NOT NULL,
	"etiqueta" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cvm_pk" PRIMARY KEY("tenant_id","alegra_id")
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'catalog_variantes_manuales_tenant_id_tenants_id_fk'
  ) THEN
    ALTER TABLE "catalog_variantes_manuales"
      ADD CONSTRAINT "catalog_variantes_manuales_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cvm_tenant_grupo" ON "catalog_variantes_manuales" USING btree ("tenant_id","grupo_id");
