-- Estado del OTP del portal en el servidor + revocación de sesiones del admin (corrida de
-- seguridad 2026-10-08).
--
-- Por qué: el código de acceso al portal vivía entero dentro de la cookie sellada `portal-otp`
-- (código, vencimiento y contador de intentos). Como el servidor no guardaba nada, reenviar la
-- cookie original dejaba el contador siempre en cero y los 6 dígitos se podían forzar en los
-- 10 minutos de vigencia. Ahora la cookie lleva sólo el id de esta fila; el código se guarda
-- como HMAC (nunca en claro), los intentos se cuentan en SQL (atómico) y el código se consume
-- una sola vez.
--
--  - portal_otps: un código emitido por send-code. `intentos` lo incrementa verify-code en el
--    mismo UPDATE que lee el hash; `consumed_at` lo cierra al validar. Las filas vencidas se
--    borran de forma oportunista al emitir el siguiente código del mismo identificador.
--  - admin_users.sessions_revoked_before: las cookies `admin-session` emitidas antes de esa
--    fecha dejan de valer (lo setea reset-password; sin valor, no revoca nada). Las sesiones
--    vivas no se tocan: la columna arranca NULL.
--
-- Aditiva: el código anterior ignora la tabla y la columna. Aplicar en prod ANTES de abrir el PR.
--
-- Reversa (en una migración nueva, SOLO después de volver el código atrás; nunca editar ésta):
--   ALTER TABLE "admin_users" DROP COLUMN "sessions_revoked_before";
--   DROP TABLE "portal_otps";

CREATE TABLE "portal_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"identifier" text NOT NULL,
	"codigocliente" text NOT NULL,
	"code_hash" text NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_otps" ADD CONSTRAINT "portal_otps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "po_tenant_identifier" ON "portal_otps" USING btree ("tenant_id","identifier","created_at");
--> statement-breakpoint
CREATE INDEX "po_expira" ON "portal_otps" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "sessions_revoked_before" timestamp with time zone;
