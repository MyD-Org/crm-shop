-- Auditoría de los vínculos hechos o deshechos desde el admin del CRM, change
-- `clientes-tienda-admin` (R4a).
--
-- El admin del CRM (rol dueño) inserta en `shop.client_links` vínculos con metodo 'operador'
-- y los revoca (estado 'revocada' + revoked_at; nunca DELETE). Estas cuatro columnas guardan
-- quién lo hizo: id del usuario del CRM y su nombre CONGELADO (sin FK a public.admin_users, así
-- el historial sobrevive a la baja del operador; patrón `estado_actualizado_por_nombre`).
--
-- Nullable: los caminos del Shop (email_verificado, otp_email, cookie_crm) no las escriben.
-- Sólo agrega columnas sin default: no reescribe la tabla ni toma locks largos. shop_app no
-- necesita permisos nuevos (el Shop no las lee todavía; si las leyera, el SELECT de la tabla
-- ya las cubre).
--
-- Reversa (en una migración nueva, SOLO después de revertir el código del CRM que las escribe):
--   ALTER TABLE shop.client_links DROP COLUMN vinculado_por, DROP COLUMN vinculado_por_nombre,
--     DROP COLUMN revocado_por, DROP COLUMN revocado_por_nombre;
ALTER TABLE "shop"."client_links" ADD COLUMN "vinculado_por" uuid;--> statement-breakpoint
ALTER TABLE "shop"."client_links" ADD COLUMN "vinculado_por_nombre" text;--> statement-breakpoint
ALTER TABLE "shop"."client_links" ADD COLUMN "revocado_por" uuid;--> statement-breakpoint
ALTER TABLE "shop"."client_links" ADD COLUMN "revocado_por_nombre" text;
