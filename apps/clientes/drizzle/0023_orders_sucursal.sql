-- Sucursal congelada en el pedido (change `sucursales-igz-mdp`, rebanada A). ADITIVA: solo columnas
-- nullable, el código anterior sigue funcionando (la reversa es revertir el código; las columnas
-- quedan inertes).
--
-- - `sucursal`: slug de `public.sucursales` (CRM). SIN FK: es otro esquema y `shop_app` no tiene
--   REFERENCES sobre `public` (mismo patrón que `tenant_id`).
-- - `sucursal_regla`: snapshot jsonb de la regla que asignó la sucursal (`ReglaAplicada`).
-- - `sucursal_asignada_en`: cuándo se asignó.
--
-- Backfill: los pedidos anteriores quedan con la sucursal MAESTRA de su tenant, pero SOLO si
-- `public.sucursales` existe y tiene una maestra (si no, quedan NULL y el admin los muestra como
-- "Sin sucursal"). Va con SQL dinámico y `to_regclass` para que esta migración no falle si la del
-- CRM (0041) todavía no se aplicó. Corre con el rol dueño (lee `maestra`, que `shop_app` no ve).
ALTER TABLE "shop"."orders" ADD COLUMN "sucursal" text;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "sucursal_regla" jsonb;--> statement-breakpoint
ALTER TABLE "shop"."orders" ADD COLUMN "sucursal_asignada_en" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.sucursales') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE "shop"."orders" o
      SET "sucursal" = s."slug"
      FROM "public"."sucursales" s
      WHERE s."tenant_id" = o."tenant_id" AND s."maestra" AND o."sucursal" IS NULL
    $q$;
  END IF;
END $$;
