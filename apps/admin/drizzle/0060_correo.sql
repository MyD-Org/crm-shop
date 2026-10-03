-- Correo compartido en el CRM (cambio `correo-en-crm`, rebanada R1): casillas de Resend Inboxes,
-- accesos por casilla y espejo mínimo por hilo (carpeta/leído) + idempotencia del webhook.
--
-- Aditiva: solo crea 4 tablas nuevas; ninguna tabla previa cambia. Sin datos (el repo es público).
-- Los cuerpos, asuntos y adjuntos viven en Resend, no acá.
--
-- Orden de rollout: aplicar a prod ANTES de mergear el código que lee estas tablas.
--
-- Reversa (en una migración NUEVA, nunca editar ésta):
--   DROP TABLE "correo_hilos", "correo_casilla_accesos", "correo_eventos", "correo_casillas";

CREATE TABLE "correo_casilla_accesos" (
	"casilla_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	CONSTRAINT "correo_casilla_accesos_pk" PRIMARY KEY("casilla_id","admin_user_id")
);
--> statement-breakpoint
CREATE TABLE "correo_casillas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"resend_inbox_id" text NOT NULL,
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correo_casillas_resend_inbox_id_unique" UNIQUE("resend_inbox_id")
);
--> statement-breakpoint
CREATE TABLE "correo_eventos" (
	"svix_id" text PRIMARY KEY NOT NULL,
	"recibido_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correo_hilos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"casilla_id" uuid NOT NULL,
	"resend_thread_id" text NOT NULL,
	"folder" text DEFAULT 'inbox' NOT NULL,
	"leido" boolean DEFAULT false NOT NULL,
	"ultimo_evento_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "correo_casilla_accesos" ADD CONSTRAINT "correo_casilla_accesos_casilla_id_correo_casillas_id_fk" FOREIGN KEY ("casilla_id") REFERENCES "public"."correo_casillas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correo_casilla_accesos" ADD CONSTRAINT "correo_casilla_accesos_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correo_casillas" ADD CONSTRAINT "correo_casillas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correo_hilos" ADD CONSTRAINT "correo_hilos_casilla_id_correo_casillas_id_fk" FOREIGN KEY ("casilla_id") REFERENCES "public"."correo_casillas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "correo_casillas_tenant_idx" ON "correo_casillas" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "correo_hilos_casilla_thread_uniq" ON "correo_hilos" USING btree ("casilla_id","resend_thread_id");--> statement-breakpoint
CREATE INDEX "correo_hilos_casilla_folder_leido_idx" ON "correo_hilos" USING btree ("casilla_id","folder","leido");