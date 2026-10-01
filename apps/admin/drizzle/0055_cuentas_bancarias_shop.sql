-- Cuentas bancarias para el pago por transferencia del Shop (change `pago-transferencia-comprobante`,
-- rebanada A).
--
-- Solo ESTRUCTURA: cero datos reales. Las cuentas (alias, CBU, CUIT) las carga la usuaria por el
-- admin; el repo es público.
--
-- Una cuenta pertenece a un tenant y declara a qué pedidos aplica:
--   - `todas_las_sucursales` (booleano EXPLÍCITO, nunca "lista vacía = todas"): true aplica a
--     cualquier pedido, también sin sucursal resoluble o con el flag `sucursales` apagado; false
--     exige listar al menos una sucursal en `sucursal_slugs` (slugs de `sucursales`, validados por
--     la app; sin FK porque el slug es inmutable y una sucursal dada de baja simplemente no matchea).
--   - `monto_min` / `monto_max`: rango inclusivo sobre el total con impuestos; NULL = sin límite.
--   - `orden`: gana la menor entre las que cumplen. `predeterminada` (a lo sumo una por tenant) es
--     una cuenta más que compite por `orden` y además es respaldo si ninguna cumple.
-- CHECKs: CBU de 22 dígitos, CUIT de 11 (o vacío), todas OR >=1 sucursal, todas => lista vacía,
-- 0 <= min <= max, max > 0, predeterminada => activa. UNIQUE (tenant_id, cbu).
--
-- GRANT a `shop_app` (el Shop la lee, no la escribe): SELECT POR COLUMNA, sin `created_at` ni
-- `updated_at`. Condicional como 0035/0041/0046: si el rol se crea DESPUÉS de esta migración,
-- correr el bloque DO $$ a mano como owner (docs/FUNCIONALIDADES.md, "Permisos de `shop_app`
-- sobre `public`").
--
-- Drift que vive SOLO en SQL (como 0041/0046): los CHECKs, el índice único parcial de la
-- predeterminada y el GRANT no están en src/db/schema.ts. El snapshot 0055 solo suma la tabla, sus
-- columnas, la FK y el UNIQUE.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   DROP TABLE "cuentas_bancarias_shop";

CREATE TABLE "cuentas_bancarias_shop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"alias" text NOT NULL,
	"cbu" text NOT NULL,
	"banco" text DEFAULT '' NOT NULL,
	"titular" text DEFAULT '' NOT NULL,
	"cuit" text DEFAULT '' NOT NULL,
	"todas_las_sucursales" boolean DEFAULT false NOT NULL,
	"sucursal_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"monto_min" numeric(14, 2),
	"monto_max" numeric(14, 2),
	"activa" boolean DEFAULT true NOT NULL,
	"predeterminada" boolean DEFAULT false NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cuentas_bancarias_shop_cbu_check" CHECK ("cbu" ~ '^[0-9]{22}$'),
	CONSTRAINT "cuentas_bancarias_shop_cuit_check" CHECK ("cuit" = '' OR "cuit" ~ '^[0-9]{11}$'),
	CONSTRAINT "cuentas_bancarias_shop_sucursales_check" CHECK ("todas_las_sucursales" OR cardinality("sucursal_slugs") >= 1),
	CONSTRAINT "cuentas_bancarias_shop_todas_sin_lista_check" CHECK (NOT "todas_las_sucursales" OR cardinality("sucursal_slugs") = 0),
	CONSTRAINT "cuentas_bancarias_shop_monto_min_check" CHECK ("monto_min" IS NULL OR "monto_min" >= 0),
	CONSTRAINT "cuentas_bancarias_shop_monto_max_check" CHECK ("monto_max" IS NULL OR "monto_max" > 0),
	CONSTRAINT "cuentas_bancarias_shop_rango_check" CHECK ("monto_min" IS NULL OR "monto_max" IS NULL OR "monto_min" <= "monto_max"),
	CONSTRAINT "cuentas_bancarias_shop_predeterminada_activa_check" CHECK (NOT "predeterminada" OR "activa")
);
--> statement-breakpoint
ALTER TABLE "cuentas_bancarias_shop" ADD CONSTRAINT "cuentas_bancarias_shop_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cuentas_bancarias_shop_tenant_cbu_uniq" ON "cuentas_bancarias_shop" USING btree ("tenant_id","cbu");
--> statement-breakpoint
CREATE UNIQUE INDEX "cuentas_bancarias_shop_predeterminada_uniq" ON "cuentas_bancarias_shop" USING btree ("tenant_id") WHERE "predeterminada";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ("id", "tenant_id", "alias", "cbu", "banco", "titular", "cuit", "todas_las_sucursales", "sucursal_slugs", "monto_min", "monto_max", "activa", "predeterminada", "orden")
      ON "public"."cuentas_bancarias_shop" TO shop_app;
  END IF;
END $$;
