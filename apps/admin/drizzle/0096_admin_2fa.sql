-- Verificación en dos pasos (TOTP) del backoffice. Ver src/lib/admin-totp.ts y admin-2fa.ts.
-- Obligatoria para admin y superadmin; opcional para operadores.
--  - totp_secret_enc: secreto cifrado (AES-256-GCM). NULL = sin 2FA.
--  - totp_enabled_at: cuándo se dio de alta.
--  - totp_last_step: último paso de 30 s aceptado (un código no vale dos veces).
--  - totp_recovery_hashes: SHA-256 de los códigos de respaldo que quedan sin usar.
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "totp_recovery_hashes" text[] DEFAULT '{}'::text[] NOT NULL;
