-- Espejo de precios por lista y costo de las cuentas de Alegra SECUNDARIAS (change
-- `listas-alegra-desde-costo`, rebanada R1). Lo llena la sync de la cuenta (`syncCuentaSecundaria`:
-- ya lee todos los ítems, así que no hay requests de más) y lo refresca el webhook de la cuenta.
-- Sirve para comparar, sin lecturas en vivo, el precio que tiene la cuenta contra el calculado.
-- Para la cuenta PRINCIPAL no hay tabla: sus precios están en `catalog_products.precios_alegra`.
--
-- `item_id` es el id del ítem EN ESA CUENTA (el mismo que `catalog_stock_sucursal.item_id_cuenta`).
-- `precios`: [{idPriceList, name, price}]. `costo`: inventory.unitCost sin IVA (NULL = sin costo).
-- `leido_at` es el instante de la lectura (guarda de frescura: un dato viejo no pisa a uno nuevo).
--
-- Seguridad: solo el CRM. SIN GRANT a `shop_app` y sin vistas: el Shop no lee esta tabla (el costo
-- nunca viaja al Shop). Un test de integración verifica que `shop_app` recibe 42501.
--
-- Numeración: la 0103 (CHECK de `precios_online_cambios.tipo` con `ajuste_lote`) viene de otro PR y
-- ya está aplicada en staging y prod; esta es la 0104 y es independiente de ella.
--
-- Orden de aplicación: aplicarla a mano en staging y en prod ANTES de mergear el código que la
-- escribe (`db:migrate` no corre en el deploy). Migración aditiva: sin consumidores previos.
--
-- Reversa (en una migración nueva, SOLO después de sacar el código que la usa):
--   DROP TABLE catalog_precios_cuenta;
CREATE TABLE "catalog_precios_cuenta" (
	"tenant_id" text NOT NULL,
	"cuenta_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"tipo" text DEFAULT 'simple' NOT NULL,
	"estado" text DEFAULT 'active' NOT NULL,
	"precios" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"costo" numeric(14, 4),
	"leido_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_precios_cuenta_pk" PRIMARY KEY("tenant_id","cuenta_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_precios_cuenta" ADD CONSTRAINT "catalog_precios_cuenta_cuenta_fk" FOREIGN KEY ("tenant_id","cuenta_id") REFERENCES "public"."alegra_cuentas"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
