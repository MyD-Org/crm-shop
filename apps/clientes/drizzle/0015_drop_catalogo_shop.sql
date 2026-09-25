-- Se dropea la copia propia del catálogo del Shop, change `catalogo-shop-desde-crm` (PR-3 + PR-4).
--
-- El Shop lee TODO su catálogo de las vistas del CRM (`public.catalog_products_shop` y
-- `public.catalog_categories_shop`, desde #130) y la sync propia que llenaba estas tablas se
-- borró en el mismo cambio que esta migración. Nadie las lee ni las escribe.
--
-- Sin CASCADE a propósito: nada depende de estas tablas (sin FKs entrantes; `shop.stock_reservado`
-- lee orders/order_items; favoritos, carritos y líneas de pedido guardan el id de Alegra sin FK).
-- Si en alguna base apareciera algo que dependa, la migración FALLA en vez de arrastrarlo.
--
-- NO se toca `"shop".immutable_unaccent` (0000): la búsqueda del catálogo la sigue usando sobre
-- las columnas de la vista del CRM (src/lib/catalog.ts).
--
-- Reversa: irreversible sin datos. Volver atrás = migración NUEVA que recree las 3 tablas con el
-- DDL de 0000_baseline.sql (+ índices cc_*/cp_*/csl_started), revert del cambio que borró la sync
-- (script, workflow `clientes-catalogo-sync`, secrets `CLIENTES_*`) y una corrida de la sync.
-- Nunca editar esta migración una vez aplicada.
DROP TABLE "shop"."catalog_categories";--> statement-breakpoint
DROP TABLE "shop"."catalog_products";--> statement-breakpoint
DROP TABLE "shop"."catalog_sync_log";
