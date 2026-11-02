-- Cupones de descuento (spec apps/admin/docs/superpowers/specs/2026-11-01-cupones-design.md).
--
-- Va después de la 0096 (2FA del admin, ya en staging). Su par del Shop es la 0041 (`shop.cupon_canjes`,
-- `orders.cupon`, `order_items.precio_sin_cupon`, `carts.cupon`); correr ésta primero.
--
-- Una promoción es la regla (beneficio, condiciones, vigencia); un código es lo que tipea el
-- comprador. 'generica' = un código elegido a mano que usan muchos; 'unicos' = códigos
-- `<PREFIJO>-XXXXX` de un solo uso, emitidos en lote o por el endpoint del bot
-- (/api/integraciones/cupones/emitir, auth por `token_hash`).
--
-- `codigo_norm` (generada): mayúsculas y sólo [A-Z0-9]. Es la clave de búsqueda del Shop y la del
-- índice único por tenant: "luz 7kq2m" y "LUZ-7KQ2M" son el mismo código.
--
-- Drift que vive SOLO en SQL: los CHECK de tipo, pct, ventana, beneficio, prefijo, origen y días.
--
-- El Shop lee `cupones_shop` (SIN filtro de fecha: necesita ver los vencidos para decir "Este cupón
-- venció"); nunca las tablas, ni `token_hash`, `creado_por` o `referencia_externa`. Los canjes son
-- del Shop (`shop.cupon_canjes`, 0041) y su estado se calcula desde el pedido.
--
-- Reversa (en una migración nueva, SOLO después de sacar el código del Shop que lo usa):
--   DROP VIEW cupones_shop; restaurar el CHECK de tipo de precios_online_cambios de 0095;
--   DROP TABLE cupon_codigos; DROP TABLE cupon_promociones.
CREATE TABLE "cupon_promociones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"pct" smallint,
	"envio_gratis" boolean DEFAULT false NOT NULL,
	"provincias_envio" text[],
	"inicio" timestamp with time zone NOT NULL,
	"fin" timestamp with time zone NOT NULL,
	"vence_dias_desde_emision" smallint,
	"solo_primera_compra" boolean DEFAULT true NOT NULL,
	"minimo" numeric(14, 2),
	"medios" text[],
	"formas" text[],
	"permite_cuotas" boolean DEFAULT false NOT NULL,
	"limite_canjes" integer,
	"condiciones" text DEFAULT '' NOT NULL,
	"prefijo" text,
	"activa" boolean DEFAULT true NOT NULL,
	"token_hash" text,
	"token_creado_en" timestamp with time zone,
	"creado_por" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cupon_promociones_tipo_chk" CHECK ("tipo" IN ('generica', 'unicos')),
	CONSTRAINT "cupon_promociones_pct_chk" CHECK ("pct" IS NULL OR "pct" BETWEEN 1 AND 50),
	CONSTRAINT "cupon_promociones_dias_chk" CHECK ("vence_dias_desde_emision" IS NULL OR "vence_dias_desde_emision" > 0),
	CONSTRAINT "cupon_promociones_limite_chk" CHECK ("limite_canjes" IS NULL OR "limite_canjes" > 0),
	CONSTRAINT "cupon_promociones_ventana_chk" CHECK ("fin" > "inicio"),
	CONSTRAINT "cupon_promociones_beneficio_chk" CHECK ("pct" IS NOT NULL OR "envio_gratis"),
	CONSTRAINT "cupon_promociones_prefijo_chk" CHECK (("prefijo" IS NULL OR "prefijo" ~ '^[A-Z]{2,8}$') AND ("tipo" = 'generica' OR "prefijo" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "cupon_promociones" ADD CONSTRAINT "cupon_promociones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "cupon_promociones_tenant_fin_idx" ON "cupon_promociones" USING btree ("tenant_id","fin");
--> statement-breakpoint
CREATE UNIQUE INDEX "cupon_promociones_token_hash" ON "cupon_promociones" USING btree ("token_hash") WHERE "cupon_promociones"."token_hash" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "cupon_codigos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promocion_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"codigo" text NOT NULL,
	"codigo_norm" text GENERATED ALWAYS AS (regexp_replace(upper("codigo"), '[^A-Z0-9]', '', 'g')) STORED,
	"origen" text NOT NULL,
	"referencia_externa" text,
	"vence_en" timestamp with time zone,
	"emitido_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cupon_codigos_origen_chk" CHECK ("origen" IN ('manual', 'lote', 'integracion'))
);
--> statement-breakpoint
ALTER TABLE "cupon_codigos" ADD CONSTRAINT "cupon_codigos_promocion_id_cupon_promociones_id_fk" FOREIGN KEY ("promocion_id") REFERENCES "public"."cupon_promociones"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cupon_codigos" ADD CONSTRAINT "cupon_codigos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cupon_codigos_tenant_norm" ON "cupon_codigos" USING btree ("tenant_id","codigo_norm");
--> statement-breakpoint
CREATE UNIQUE INDEX "cupon_codigos_promo_ref" ON "cupon_codigos" USING btree ("promocion_id","referencia_externa") WHERE "cupon_codigos"."referencia_externa" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "cupon_codigos_promocion_idx" ON "cupon_codigos" USING btree ("promocion_id","origen");
--> statement-breakpoint
ALTER TABLE "precios_online_cambios" DROP CONSTRAINT "precios_online_cambios_tipo_chk";
--> statement-breakpoint
ALTER TABLE "precios_online_cambios" ADD CONSTRAINT "precios_online_cambios_tipo_chk" CHECK ("tipo" IN ('lista_alta','lista_edicion','lista_baja','referencia','override_alta','override_edicion','override_baja','umbral','condicion','revertir','costo_aprobado','costo_rechazado','mapeo','campania','cupon'));
--> statement-breakpoint
-- Lo que el Shop lee para validar un cupón: código + promoción. Sin filtro de fecha (vencidos
-- incluidos) y sin datos internos (token, autor, referencia del bot).
CREATE VIEW "public"."cupones_shop" AS
SELECT c.tenant_id,
       c.id AS codigo_id,
       c.codigo,
       c.codigo_norm,
       p.id AS promocion_id,
       p.nombre,
       p.tipo,
       p.pct,
       p.envio_gratis,
       p.provincias_envio,
       p.inicio,
       p.fin,
       c.vence_en,
       p.solo_primera_compra,
       p.minimo,
       p.medios,
       p.formas,
       p.permite_cuotas,
       p.limite_canjes,
       p.condiciones,
       p.activa
FROM "public"."cupon_codigos" c
JOIN "public"."cupon_promociones" p ON p.id = c.promocion_id AND p.tenant_id = c.tenant_id;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ON "public"."cupones_shop" TO shop_app;
  END IF;
END $$;
