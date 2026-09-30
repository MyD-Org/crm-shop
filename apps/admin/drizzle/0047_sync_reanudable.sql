-- Sync del catálogo reanudable por tramos (fix del 504: la cuenta principal de un tenant grande
-- tarda ~5 min y no entra en una invocación). Solo estructura, sin datos.
-- - `catalog_sync_cursor`: una fila por tenant con la corrida a medias (cuenta actual, offset de
--   lectura, resultados cerrados). Se borra al terminar. `lock_hasta` = tramo en ejecución.
-- - `catalog_sync_log.actividad_at`: última señal de vida; una corrida 'running' sin actividad
--   hace más de N min se considera abandonada.

CREATE TABLE "catalog_sync_cursor" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"cursor" jsonb NOT NULL,
	"lock_hasta" timestamp with time zone,
	"actividad_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_sync_log" ADD COLUMN "actividad_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_sync_cursor" ADD CONSTRAINT "catalog_sync_cursor_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;