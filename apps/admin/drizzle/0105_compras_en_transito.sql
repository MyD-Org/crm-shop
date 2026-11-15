-- Compras en tránsito (change `compras-en-transito`, rebanada S3: esquema). SÓLO tablas nuevas e
-- índices: aditiva, sin tocar ninguna tabla existente y sin datos (cero seed).
--
-- - `alegra_compras_config`: por cuenta de Alegra, categoría contable del tránsito, mapa
--   nombre -> idPerception (el catálogo de percepciones no es listable por API) y almacén.
-- - `compras`: la factura del proveedor (1 bill de Alegra). Importes en centavos.
-- - `compra_items`: ítems pedidos/recibidos. `neto_e5` = costo x cantidad pedida exacto, en
--   cienmilésimas de peso (Alegra no redondea el IVA por línea).
-- - `compra_percepciones`: percepciones; NO son líneas de la bill (se aplican por /perceptions).
-- - `compra_recepciones` (+ `_items`): cada recepción parcial o total, con idempotencia y hashes
--   de las líneas antes/esperadas para reconciliar un PUT incierto.
-- Las hijas llevan FK compuesta (tenant_id, id): un hijo no puede pertenecer a otro tenant.
-- Un solo proveedor + número vivo por cuenta, y una sola recepción en vuelo por compra
-- (índices únicos parciales).
--
-- SIN GRANT a `shop_app`: el costo de compra no viaja al Shop.
--
-- Drift que vive SOLO en SQL (schema.ts no declara los CHECK): moneda, estados, importes y cantidades.
--
-- Reversa (migración nueva, sólo si nada las usa): DROP TABLE compra_recepcion_items,
-- compra_recepciones, compra_percepciones, compra_items, compras, alegra_compras_config;
CREATE TABLE "alegra_compras_config" (
	"tenant_id" text NOT NULL,
	"cuenta_id" uuid NOT NULL,
	"categoria_transito_id" text,
	"categoria_transito_nombre" text,
	"percepciones" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"almacen_id" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alegra_compras_config_pk" PRIMARY KEY("tenant_id","cuenta_id")
);
--> statement-breakpoint
CREATE TABLE "compra_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"compra_id" uuid NOT NULL,
	"orden" integer NOT NULL,
	"alegra_id" text NOT NULL,
	"item_id_cuenta" text NOT NULL,
	"codigo" text,
	"nombre" text NOT NULL,
	"cantidad_pedida" numeric(14, 3) NOT NULL,
	"cantidad_recibida" numeric(14, 3) DEFAULT '0' NOT NULL,
	"costo_unitario_centavos" bigint NOT NULL,
	"iva_porcentaje" numeric(5, 2) NOT NULL,
	"tax_alegra_id" text NOT NULL,
	"neto_e5" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compra_percepciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"compra_id" uuid NOT NULL,
	"alegra_perception_id" text NOT NULL,
	"nombre" text NOT NULL,
	"importe_centavos" bigint NOT NULL,
	"numero_certificado" text
);
--> statement-breakpoint
CREATE TABLE "compra_recepcion_items" (
	"tenant_id" text NOT NULL,
	"recepcion_id" uuid NOT NULL,
	"compra_item_id" uuid NOT NULL,
	"cantidad" numeric(14, 3) NOT NULL,
	"monto_neto_e5" bigint NOT NULL,
	CONSTRAINT "compra_recepcion_items_pk" PRIMARY KEY("recepcion_id","compra_item_id")
);
--> statement-breakpoint
CREATE TABLE "compra_recepciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"compra_id" uuid NOT NULL,
	"secuencia" integer NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"idempotency_key" text NOT NULL,
	"remito" text,
	"fecha" date NOT NULL,
	"notas" text,
	"lineas_antes_hash" text NOT NULL,
	"lineas_esperadas_hash" text NOT NULL,
	"total_antes_centavos" bigint NOT NULL,
	"total_despues_centavos" bigint,
	"motivo_fallo" text,
	"creada_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"aplicada_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "compras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"cuenta_id" uuid NOT NULL,
	"proveedor_alegra_id" text NOT NULL,
	"proveedor_nombre" text NOT NULL,
	"proveedor_cuit" text,
	"numero_factura" text NOT NULL,
	"fecha" date NOT NULL,
	"vencimiento" date NOT NULL,
	"observaciones" text,
	"moneda" text DEFAULT 'ARS' NOT NULL,
	"almacen_id" text NOT NULL,
	"estado" text DEFAULT 'creando' NOT NULL,
	"desincronizada" boolean DEFAULT false NOT NULL,
	"alegra_bill_id" text,
	"neto_centavos" bigint NOT NULL,
	"iva_centavos" bigint NOT NULL,
	"percepciones_centavos" bigint DEFAULT 0 NOT NULL,
	"total_centavos" bigint NOT NULL,
	"snapshot" jsonb,
	"snapshot_hash" text,
	"idempotency_key" text NOT NULL,
	"creada_por" uuid,
	"cierre_estado" text,
	"cierre_idempotency_key" text,
	"cierre_nc_numero" text,
	"cierre_importe_centavos" bigint,
	"cierre_alegra_id" text,
	"cierre_motivo" text,
	"cierre_at" timestamp with time zone,
	"anulada_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "compra_items_tenant_id_uniq" ON "compra_items" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "compra_items_compra_orden_uniq" ON "compra_items" USING btree ("compra_id","orden");
--> statement-breakpoint
CREATE INDEX "compra_percepciones_compra_idx" ON "compra_percepciones" USING btree ("compra_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "compra_recepciones_tenant_id_uniq" ON "compra_recepciones" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "compra_recepciones_compra_secuencia_uniq" ON "compra_recepciones" USING btree ("compra_id","secuencia");
--> statement-breakpoint
CREATE UNIQUE INDEX "compra_recepciones_compra_idempotency_uniq" ON "compra_recepciones" USING btree ("compra_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "compra_recepciones_en_vuelo_uniq" ON "compra_recepciones" USING btree ("compra_id") WHERE "compra_recepciones"."estado" IN ('pendiente','incierta');
--> statement-breakpoint
CREATE UNIQUE INDEX "compras_tenant_id_uniq" ON "compras" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "compras_tenant_idempotency_uniq" ON "compras" USING btree ("tenant_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "compras_proveedor_numero_uniq" ON "compras" USING btree ("tenant_id","cuenta_id","proveedor_alegra_id","numero_factura") WHERE "compras"."estado" NOT IN ('anulada','anulada_en_alegra');
--> statement-breakpoint
CREATE UNIQUE INDEX "compras_alegra_bill_uniq" ON "compras" USING btree ("tenant_id","cuenta_id","alegra_bill_id") WHERE "compras"."alegra_bill_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "compras_tenant_estado_idx" ON "compras" USING btree ("tenant_id","estado","created_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "alegra_compras_config" ADD CONSTRAINT "alegra_compras_config_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "alegra_compras_config" ADD CONSTRAINT "alegra_compras_config_cuenta_fk" FOREIGN KEY ("tenant_id","cuenta_id") REFERENCES "public"."alegra_cuentas"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_compra_fk" FOREIGN KEY ("tenant_id","compra_id") REFERENCES "public"."compras"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compra_percepciones" ADD CONSTRAINT "compra_percepciones_compra_fk" FOREIGN KEY ("tenant_id","compra_id") REFERENCES "public"."compras"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compra_recepcion_items" ADD CONSTRAINT "compra_recepcion_items_recepcion_fk" FOREIGN KEY ("tenant_id","recepcion_id") REFERENCES "public"."compra_recepciones"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compra_recepcion_items" ADD CONSTRAINT "compra_recepcion_items_item_fk" FOREIGN KEY ("tenant_id","compra_item_id") REFERENCES "public"."compra_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compra_recepciones" ADD CONSTRAINT "compra_recepciones_creada_por_admin_users_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compra_recepciones" ADD CONSTRAINT "compra_recepciones_compra_fk" FOREIGN KEY ("tenant_id","compra_id") REFERENCES "public"."compras"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_creada_por_admin_users_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_cuenta_fk" FOREIGN KEY ("tenant_id","cuenta_id") REFERENCES "public"."alegra_cuentas"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_moneda_chk" CHECK ("moneda" = 'ARS');
--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_estado_chk" CHECK ("estado" IN ('creando','pendiente','parcial','completa','cerrada_faltante','anulada','anulada_en_alegra'));
--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_importes_chk" CHECK ("neto_centavos" >= 0 AND "iva_centavos" >= 0 AND "percepciones_centavos" >= 0 AND "total_centavos" > 0);
--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_cierre_estado_chk" CHECK ("cierre_estado" IS NULL OR "cierre_estado" IN ('pendiente','aplicado','incierto','manual'));
--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_cierre_importe_chk" CHECK ("cierre_importe_centavos" IS NULL OR "cierre_importe_centavos" > 0);
--> statement-breakpoint
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_cantidades_chk" CHECK ("cantidad_pedida" > 0 AND "cantidad_recibida" >= 0 AND "cantidad_recibida" <= "cantidad_pedida");
--> statement-breakpoint
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_importes_chk" CHECK ("costo_unitario_centavos" >= 0 AND "neto_e5" >= 0 AND "iva_porcentaje" >= 0 AND "iva_porcentaje" <= 100);
--> statement-breakpoint
ALTER TABLE "compra_percepciones" ADD CONSTRAINT "compra_percepciones_importe_chk" CHECK ("importe_centavos" > 0);
--> statement-breakpoint
ALTER TABLE "compra_recepciones" ADD CONSTRAINT "compra_recepciones_estado_chk" CHECK ("estado" IN ('pendiente','aplicada','fallida','incierta'));
--> statement-breakpoint
ALTER TABLE "compra_recepciones" ADD CONSTRAINT "compra_recepciones_importes_chk" CHECK ("secuencia" > 0 AND "total_antes_centavos" > 0);
--> statement-breakpoint
ALTER TABLE "compra_recepcion_items" ADD CONSTRAINT "compra_recepcion_items_chk" CHECK ("cantidad" > 0 AND "monto_neto_e5" >= 0);
