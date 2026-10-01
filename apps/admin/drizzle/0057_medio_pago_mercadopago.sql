-- Fila fija de Mercado Pago en los medios de pago del checkout (change `medios-pago-desde-admin`,
-- rebanada A).
--
-- Solo DATOS, cero cambios de esquema: por cada tenant se siembra `mercadopago` con
-- `cobro_online = true` y `activo = false`, al final del orden actual. Inactiva: el checkout de
-- prod no cambia hasta que se active desde el admin (Cuotas > Medios de pago del checkout). El
-- admin la edita (activo, orden, entrega, textos) pero no la crea, no la elimina ni cambia su slug.
-- Idempotente: ON CONFLICT DO NOTHING no pisa una fila que ya exista.
--
-- Reversa (en una migración nueva, nunca editar ésta):
--   DELETE FROM "medios_pago_shop" WHERE "slug" = 'mercadopago';

INSERT INTO "medios_pago_shop" ("tenant_id", "slug", "nombre", "activo", "aplica_retiro", "aplica_envio", "cobro_online", "orden")
SELECT t."id", 'mercadopago', 'Mercado Pago', false, true, true, true,
  COALESCE((SELECT max(m."orden") + 1 FROM "medios_pago_shop" m WHERE m."tenant_id" = t."id"), 0)
FROM "tenants" t
ON CONFLICT ("tenant_id", "slug") DO NOTHING;
