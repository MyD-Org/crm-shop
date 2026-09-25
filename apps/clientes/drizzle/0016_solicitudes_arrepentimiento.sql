-- Solicitudes del Botón de arrepentimiento, change `paginas-legales-shop` (PR C).
--
-- Cada envío del form público `/arrepentimiento` (Res. 424/2020, art. 34 Ley 24.240) queda
-- guardado ANTES de mandar los mails: el código ARR-000001 (del `numero` identity) se muestra
-- aunque Resend falle, y el resultado de los avisos queda en `email_*`.
--
-- Datos personales mínimos: nombre, email, teléfono, pedido y motivo que tipea la persona. Sin IP
-- ni user agent (el rate limit por IP es en memoria). El email llega normalizado (trim +
-- minúsculas) desde la app, así que el índice por email no usa lower().
--
-- Reversa (a mano, SOLO después de revertir el código del Shop que la escribe), en una migración
-- nueva, append-only; nunca editar ésta:
--   DROP TABLE "shop"."solicitudes_arrepentimiento";
CREATE TABLE "shop"."solicitudes_arrepentimiento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" integer GENERATED ALWAYS AS IDENTITY (sequence name "shop"."solicitudes_arrepentimiento_numero_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" text NOT NULL,
	"nombre" text NOT NULL,
	"email" text NOT NULL,
	"telefono" text NOT NULL,
	"pedido_numero" text,
	"motivo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_cliente_enviado_en" timestamp with time zone,
	"email_comercio_enviado_en" timestamp with time zone,
	"email_error" text,
	CONSTRAINT "sa_largos" CHECK (char_length("shop"."solicitudes_arrepentimiento"."nombre") <= 120 and char_length("shop"."solicitudes_arrepentimiento"."email") <= 254 and char_length("shop"."solicitudes_arrepentimiento"."telefono") <= 40 and char_length(coalesce("shop"."solicitudes_arrepentimiento"."pedido_numero", '')) <= 40 and char_length(coalesce("shop"."solicitudes_arrepentimiento"."motivo", '')) <= 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sa_numero" ON "shop"."solicitudes_arrepentimiento" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "sa_tenant_email_fecha" ON "shop"."solicitudes_arrepentimiento" USING btree ("tenant_id","email","created_at");--> statement-breakpoint
-- Los DEFAULT PRIVILEGES del esquema `shop` ya le dan acceso a `shop_app` si la tabla la crea el
-- rol dueño (el de MIGRATE_DATABASE_URL). El GRANT explícito es cinturón por si la creó otro rol
-- (patrón 0012). Sin DELETE: el Shop no borra solicitudes. La secuencia identity no necesita
-- USAGE (GENERATED ALWAYS la usa la tabla). Condicional: las bases sin el rol no lo tienen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "shop"."solicitudes_arrepentimiento" TO shop_app;
  END IF;
END $$;
