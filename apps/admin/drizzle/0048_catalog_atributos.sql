-- Atributos técnicos estructurados del catálogo (catálogo asistido fase 2, subproyecto 5 "Fichas
-- técnicas estructuradas"; spec platform 2026-09-30).
--
-- `catalog_atributos`: una fila por (tenant, producto, clave). Claves cerradas: potencia_w,
-- temperatura_k, tono, ip, flujo_lm, tension_v, zocalo. Numéricas en `valor_num`, categóricas en
-- `valor_texto` ("calido", "e27"; un rango de tensión guarda además "85-265"). Sin FK a
-- `catalog_products` (como el overlay): el dato puede preceder al espejo.
--
-- Precedencia de `fuente`: manual > pdf > nombre. Una fuente NUNCA pisa a otra de mayor
-- precedencia; la regla la aplica el upsert del CRM (`lib/catalogo-atributos-repo.ts`, ON CONFLICT
-- … WHERE), no un trigger. Las filas `nombre` las escribe la sync de Alegra (y el backfill); `pdf`
-- el lector de fichas del admin; `manual` el panel del admin.
--
-- GRANT a `shop_app`, condicional como 0042/0045/0046, POR COLUMNA: el Shop lee `tenant_id`,
-- `alegra_id`, `clave`, `valor_num`, `valor_texto`. `fuente` y `updated_at` quedan vedados. Si el rol
-- se crea DESPUÉS de esta migración, correr el bloque DO $$ a mano como owner
-- (docs/FUNCIONALIDADES.md, "Permisos de `shop_app` sobre `public`"). El Shop tolera que la tabla
-- no exista o no tenga permiso (vuelve al comportamiento de la fase 1).
--
-- Drift que vive SOLO en SQL (como 0031/0041/0045/0046): los CHECK de `clave` y `fuente` y el
-- GRANT no están en src/db/schema.ts. El snapshot 0047 solo suma la tabla, su PK y su FK.
--
-- Reversa (en una migración nueva, SOLO después de sacar del Shop la lectura; nunca editar ésta):
--   DROP TABLE "catalog_atributos";

CREATE TABLE "catalog_atributos" (
	"tenant_id" text NOT NULL,
	"alegra_id" text NOT NULL,
	"clave" text NOT NULL,
	"valor_num" numeric,
	"valor_texto" text,
	"fuente" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_atributos_pk" PRIMARY KEY("tenant_id","alegra_id","clave"),
	CONSTRAINT "catalog_atributos_clave_check" CHECK ("clave" IN ('potencia_w', 'temperatura_k', 'tono', 'ip', 'flujo_lm', 'tension_v', 'zocalo')),
	CONSTRAINT "catalog_atributos_fuente_check" CHECK ("fuente" IN ('nombre', 'pdf', 'manual')),
	CONSTRAINT "catalog_atributos_valor_check" CHECK ("valor_num" IS NOT NULL OR "valor_texto" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "catalog_atributos" ADD CONSTRAINT "catalog_atributos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT USAGE ON SCHEMA public TO shop_app;
    GRANT SELECT ("tenant_id", "alegra_id", "clave", "valor_num", "valor_texto") ON "public"."catalog_atributos" TO shop_app;
  END IF;
END $$;
