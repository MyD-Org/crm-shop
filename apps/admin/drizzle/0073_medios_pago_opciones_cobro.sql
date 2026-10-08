-- Opciones de cobro por medio (change `cuotas-en-el-formulario`, rebanada 1): en cada medio con
-- cobro online el admin elige qué formas de pago ofrece el checkout. Mercado Pago: tarjeta de
-- crédito, tarjeta de débito y cuenta de Mercado Pago; Payway: crédito y débito (ignora `cuenta_mp`).
--
-- Qué cambia: `medios_pago_shop.opciones_cobro text[] NOT NULL DEFAULT {credito,debito,cuenta_mp}`,
-- con CHECK de valores permitidos. Los medios existentes quedan con todas habilitadas (= hoy).
--
-- La regla "un medio activo con cobro online necesita al menos una opción aplicable" vive en la
-- validación del admin (src/lib/medios-pago-shop-validacion.ts, post-merge del PATCH), no en un
-- CHECK: así un PATCH parcial no falla por el orden de los campos. El Shop, además, no ofrece en
-- línea un medio sin opciones aplicables.
--
-- Drift que vive SOLO en SQL (no está en src/db/schema.ts): el CHECK `medios_pago_shop_opciones_cobro_chk`.
--
-- El GRANT SELECT de `shop_app` sobre la tabla ya es de tabla entera (0046, repetido en 0069): la
-- columna nueva se lee sin GRANT adicional.
--
-- Aditiva: el Shop viejo ignora la columna; el nuevo la lee en una consulta tolerante a la columna
-- ausente (=> todas las opciones). Igual: aplicar en prod ANTES de abrir el PR.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   ALTER TABLE "medios_pago_shop" DROP CONSTRAINT "medios_pago_shop_opciones_cobro_chk";
--   ALTER TABLE "medios_pago_shop" DROP COLUMN "opciones_cobro";

ALTER TABLE "medios_pago_shop" ADD COLUMN "opciones_cobro" text[] DEFAULT ARRAY['credito','debito','cuenta_mp']::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "medios_pago_shop" ADD CONSTRAINT "medios_pago_shop_opciones_cobro_chk" CHECK ("opciones_cobro" <@ ARRAY['credito','debito','cuenta_mp']::text[]);
