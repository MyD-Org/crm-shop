-- Cuotas a mostrar en card y ficha del Shop, elegidas por proveedor (change `cuotas-card-desde-admin`).
--
-- Aditiva: una columna nullable en `payment_methods`. Sin cambios de GRANT: el Shop NO lee esta
-- tabla (recibe la config por HTTP, contrato cuotas/v2 con el campo opcional `cuotasCatalogo`).
--
-- - `cuotas_catalogo`: cantidad de cuotas (2..24) que el Shop exhibe bajo el precio de la card y en
--   la ficha. NULL = Automático (mayor cantidad sin interés; si no hay, la mayor con interés).
--   Las filas existentes quedan en NULL: el comportamiento actual no cambia.
--
-- Reversa (en una migración nueva, SOLO después de sacar del contrato el campo; nunca editar ésta):
--   ALTER TABLE "payment_methods" DROP CONSTRAINT "payment_methods_cuotas_catalogo_chk";
--   ALTER TABLE "payment_methods" DROP COLUMN "cuotas_catalogo";

ALTER TABLE "payment_methods" ADD COLUMN "cuotas_catalogo" smallint;
--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_cuotas_catalogo_chk" CHECK ("cuotas_catalogo" IS NULL OR ("cuotas_catalogo" BETWEEN 2 AND 24));
