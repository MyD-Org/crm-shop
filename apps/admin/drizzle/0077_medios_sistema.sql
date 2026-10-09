-- Medios de pago del sistema (change `modal-medios-pago`): transferencia y efectivo pasan a ser filas
-- fijas, igual que mercadopago y payway (identificador reservado, no se eliminan, sólo se desactivan).
--
-- Las sembró la 0046, pero un tenant pudo haberlas borrado. Esta migración las repone por tenant si
-- faltan, DESACTIVADAS (activo = false): una fila repuesta no aparece sola en el checkout; el equipo
-- la activa desde Configuración. Las que ya existen no se tocan (ON CONFLICT DO NOTHING). Van al
-- final del orden del tenant. Cero datos reales: nombres genéricos.
--
-- GRANT: no hace falta. `shop_app` ya tiene SELECT de la tabla `medios_pago_shop` entera (0046).
-- Drift sólo en SQL: ninguno (no cambia el esquema; el snapshot 0077 repite el 0076).
--
-- Reversa (en una migración nueva): DELETE de las filas repuestas sin pedidos; no se edita ésta.

INSERT INTO "medios_pago_shop" ("tenant_id", "slug", "nombre", "aplica_envio", "activo", "orden")
SELECT t."id", m."slug", m."nombre", m."aplica_envio", false,
  COALESCE((SELECT MAX(x."orden") FROM "medios_pago_shop" x WHERE x."tenant_id" = t."id"), -1) + m."pos"
FROM "tenants" t
CROSS JOIN (VALUES
  ('transferencia', 'Transferencia bancaria', true, 1),
  ('efectivo', 'Efectivo en el local', false, 2)
) AS m ("slug", "nombre", "aplica_envio", "pos")
ON CONFLICT ("tenant_id", "slug") DO NOTHING;
