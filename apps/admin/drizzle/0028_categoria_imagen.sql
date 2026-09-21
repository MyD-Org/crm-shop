-- Foto y origen de las categorías propias.
--
-- `imagen_key` guarda la KEY del objeto en R2, nunca la url: la base pública se compone al servir
-- (ver src/lib/shop-media.ts), así que mover las fotos a otro dominio no toca ninguna fila.
--
-- `origen_alegra_id` recuerda de qué categoría de Alegra salió una categoría importada, para que
-- correr la importación dos veces no duplique el árbol. null = creada a mano.
--
-- Aditiva: sólo ADD COLUMN, sin DROP ni NOT NULL, así revertir el código no pierde el trabajo de
-- clasificación ya hecho.
ALTER TABLE "shop_categories" ADD COLUMN IF NOT EXISTS "imagen_key" text;--> statement-breakpoint
ALTER TABLE "shop_categories" ADD COLUMN IF NOT EXISTS "imagen_alt" text;--> statement-breakpoint
ALTER TABLE "shop_categories" ADD COLUMN IF NOT EXISTS "origen_alegra_id" text;--> statement-breakpoint
-- Parcial: sólo aplica a las importadas. Dos categorías creadas a mano pueden tener null las dos.
CREATE UNIQUE INDEX IF NOT EXISTS "shop_categories_tenant_origen_uniq"
  ON "shop_categories" ("tenant_id", "origen_alegra_id")
  WHERE "origen_alegra_id" IS NOT NULL;
