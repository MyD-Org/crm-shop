-- Vínculos por cuenta de Alegra (change `shop-contactos-alegra-mdp`, rebanada S3).
--
--   client_links.alegra_account  cuenta de Alegra a la que pertenece `alegra_contact_id`: `principal`
--                                o el slug de una cuenta secundaria del tenant (`mdp`). Los ids de
--                                Alegra no son únicos entre cuentas. El Shop lee y escribe sólo los
--                                vínculos de la cuenta de su despliegue (`SHOP_CUENTA_ALEGRA`); los de
--                                otra cuenta quedan inertes (no se revocan).
--   link_otps.alegra_account     cuenta del contacto del código: un código pedido en una cuenta no
--                                confirma en otra.
--   cl_user_cuenta_activa        una vinculación activa por (usuario, cuenta). Reemplaza a
--                                `cl_user_activa` (una por usuario). Se crea antes de borrar el viejo;
--                                los datos existentes ya cumplen el nuevo (como mucho una activa por
--                                usuario, todas `principal`).
--
-- ADITIVA y segura con datos: DEFAULT constante (metadata-only en PG >= 11), sin backfill. Toda fila
-- anterior queda en `principal`, que es lo que eran. El código anterior a esta migración sigue
-- funcionando (no nombra la columna y el default la completa). Sin GRANT por columna: los roles del
-- Shop y del CRM conservan sus permisos de tabla.
--
-- Esta migración tiene que correr ANTES de desplegar el código (db:migrate no corre en el deploy).
--
-- Reversa (a mano, en una migración nueva, append-only; nunca editar ésta), sólo después de sacar el
-- código y si no quedan dos vínculos activos del mismo usuario en cuentas distintas:
--   CREATE UNIQUE INDEX "cl_user_activa" ON "shop"."client_links" USING btree ("clerk_user_id") WHERE "shop"."client_links"."estado" = 'activa';
--   DROP INDEX "shop"."cl_user_cuenta_activa";
--   ALTER TABLE "shop"."client_links" DROP CONSTRAINT "client_links_alegra_account_check";
--   ALTER TABLE "shop"."client_links" DROP COLUMN "alegra_account";
--   ALTER TABLE "shop"."link_otps" DROP COLUMN "alegra_account";
ALTER TABLE "shop"."client_links" ADD COLUMN "alegra_account" text DEFAULT 'principal' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop"."link_otps" ADD COLUMN "alegra_account" text DEFAULT 'principal' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cl_user_cuenta_activa" ON "shop"."client_links" USING btree ("clerk_user_id","alegra_account") WHERE "shop"."client_links"."estado" = 'activa';--> statement-breakpoint
DROP INDEX "shop"."cl_user_activa";--> statement-breakpoint
ALTER TABLE "shop"."client_links" ADD CONSTRAINT "client_links_alegra_account_check" CHECK ("shop"."client_links"."alegra_account" ~ '^[a-z0-9][a-z0-9-]{0,39}$');
