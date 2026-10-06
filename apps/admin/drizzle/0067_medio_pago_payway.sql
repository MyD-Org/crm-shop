-- Fila fija de Payway en los medios de pago del checkout (change `payway-cobro`, rebanada B).
--
-- Solo DATOS, cero cambios de esquema: por cada tenant se siembra `payway` con `cobro_online = true`
-- y `activo = false`, al final del orden actual. Inactiva: el checkout de prod no cambia hasta que
-- se active desde el admin (Cuotas > Medios de pago del checkout) y existan las credenciales de
-- Payway en la tienda. Convive con la fila de Mercado Pago, cada una con sus propias condiciones de
-- cuotas. El admin la edita (activo, nombre, orden, entrega, textos) pero no la crea, no la elimina
-- ni cambia su slug. Misma forma que 0057. Idempotente: ON CONFLICT DO NOTHING no pisa una fila que
-- ya exista.
--
-- Reversa (en una migración nueva, nunca editar ésta):
--   DELETE FROM "medios_pago_shop" WHERE "slug" = 'payway';

INSERT INTO "medios_pago_shop" ("tenant_id", "slug", "nombre", "activo", "aplica_retiro", "aplica_envio", "cobro_online", "orden")
SELECT t."id", 'payway', 'Tarjeta de crédito o débito - Payway', false, true, true, true,
  COALESCE((SELECT max(m."orden") + 1 FROM "medios_pago_shop" m WHERE m."tenant_id" = t."id"), 0)
FROM "tenants" t
ON CONFLICT ("tenant_id", "slug") DO NOTHING;
