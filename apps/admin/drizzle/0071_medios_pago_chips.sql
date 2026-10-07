-- Etiquetas ("chips") de los medios de pago del checkout (change `chips-medios-pago`): la usuaria
-- carga desde el admin hasta 3 etiquetas por medio (ej. "Hasta 8 cuotas sin interés", "Recomendado",
-- "15% OFF"), cada una con un tono, y el Shop las muestra resaltadas sobre la opción de ese medio.
--
-- Qué cambia: `medios_pago_shop.chips jsonb NOT NULL DEFAULT '[]'`, con CHECK de que sea un array.
-- Sin tocar datos: ningún medio existente tiene etiquetas hasta que se carguen.
--
-- Forma de cada elemento: {"texto": string 1..30 sin HTML, "tono": "destacado"|"exito"|"info"}, a lo
-- sumo 3. Esa validación fina vive en la app (admin: src/lib/medios-pago-shop-chips.ts) y el Shop
-- lee de forma tolerante (lo inválido se descarta): la base sólo garantiza que sea un array.
--
-- Drift que vive SOLO en SQL (no está en src/db/schema.ts): el CHECK `medios_pago_shop_chips_chk`.
--
-- El GRANT SELECT de `shop_app` sobre la tabla ya es de tabla entera (0046, repetido en 0069): la
-- columna nueva se lee sin GRANT adicional.
--
-- Aditiva: el Shop viejo ignora la columna; el nuevo la lee. Aplicar en prod ANTES de abrir el PR /
-- desplegar el código nuevo (una consulta del Shop con la columna ausente falla y el pago sale a coordinar).
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   ALTER TABLE "medios_pago_shop" DROP CONSTRAINT "medios_pago_shop_chips_chk";
--   ALTER TABLE "medios_pago_shop" DROP COLUMN "chips";

ALTER TABLE "medios_pago_shop" ADD COLUMN "chips" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "medios_pago_shop" ADD CONSTRAINT "medios_pago_shop_chips_chk" CHECK (jsonb_typeof("chips") = 'array');
