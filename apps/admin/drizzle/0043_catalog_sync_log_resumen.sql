-- Resumen de cada corrida de sync por cuenta (change `sucursales-igz-mdp`, rebanada D, lote 2).
--
-- Escrita a mano, como 0014-0042; el snapshot se regenera con `npx tsx scripts/drizzle-snapshot.ts`.
--
-- Aditiva: una sola columna nueva, nullable, sin DROP ni backfill. `catalog_sync_log.resumen` guarda,
-- por corrida, el detalle que las columnas numéricas no alcanzan: cuántos ítems se parearon, cuántos
-- son solo de la cuenta secundaria y las listas de "Códigos a revisar" (código duplicado o faltante,
-- listas de precio sin equivalente), que NUNCA entran al catálogo y por eso no viven en
-- `catalog_products`. Formato: ver `ResumenSync` en `apps/admin/src/lib/alegra-sync-cuenta.ts`.
-- Solo ids, códigos y nombres de producto (sin credenciales ni datos de clientes).
--
-- Sin GRANT: `shop_app` no lee `catalog_sync_log`.
--
-- Reversa: columna inerte (se puede dejar); el código que la escribe tolera que no exista solo si
-- se revierte junto con este cambio.

ALTER TABLE "catalog_sync_log" ADD COLUMN IF NOT EXISTS "resumen" jsonb;
