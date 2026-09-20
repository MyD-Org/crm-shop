-- Nada de lo que devuelve Alegra se descarta.
--
-- `raw` guarda el ítem COMPLETO tal cual viene. Hoy el lector se queda con 9 campos y tira
-- `accounting`, `calculationScale`, `category`, `itemType` y `type` enteros, más subcampos de
-- `tax`, `customFields`, `price` e `inventory`. Cada vez que hizo falta uno hubo que tocar el
-- mapper y re-sincronizar; con el crudo guardado, se resuelve con una query. Son ~2,5 KB por
-- ítem: unos 20 MB para los 8012 de Central Led.
--
-- `alegra_status` es el estado que Alegra le pone al ítem. Iba a `status`, pero el sync lo pisaba
-- con 'active' fijo, así que se perdía. Y `status` ya significa otra cosa: "visto en la última
-- corrida" (lo no visto se marca inactive). Un campo no puede tener dos significados: por eso son
-- dos columnas.
--
-- `brand` e `iva_porcentaje` son los dos campos que el espejo del Shop tiene y este no. La marca
-- no es nativa de Alegra: sale de customFields. Tenerlos acá es condición para que el Shop pueda
-- dejar de sincronizar por su cuenta.
--
-- Aditiva: sólo ADD COLUMN. Las columnas nuevas quedan nulas hasta la próxima corrida del sync.
ALTER TABLE "catalog_products" ADD COLUMN IF NOT EXISTS "raw" jsonb;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN IF NOT EXISTS "alegra_status" text;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN IF NOT EXISTS "brand" text;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN IF NOT EXISTS "iva_porcentaje" numeric(5, 2);--> statement-breakpoint
-- El bot y el contrato del Shop filtran por acá en cada consulta.
CREATE INDEX IF NOT EXISTS "cp_tenant_alegra_status" ON "catalog_products" ("tenant_id", "alegra_status");
