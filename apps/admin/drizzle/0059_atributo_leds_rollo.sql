-- Cantidad total de LED del rollo (cambio `atributo-leds-rollo`): el vocabulario cerrado de
-- `catalog_atributos.clave` pasa de 20 a 21 claves.
--
-- Nueva (se agrega al final; el orden de las 20 existentes no cambia): leds_rollo (cantidad TOTAL de LED
-- del rollo o tira, entero: 300, 600; no es por metro, eso es leds_m). Numérica (`valor_num`). El rango
-- (1–10000) vive en código (CRM y Shop), no en el CHECK.
--
-- Aditiva: el CHECK nuevo es más permisivo. No cambia columnas ni GRANT (el GRANT por columna de
-- 0049 ya cubre las filas nuevas). Las filas existentes no se tocan. El migrador corre las dos
-- sentencias en una transacción: no hay ventana sin CHECK.
--
-- Drift que vive SOLO en SQL (como 0049, 0053 y 0058): el CHECK de `clave` no está en src/db/schema.ts.
-- El snapshot 0059 es igual al 0058 (solo encadena id/prevId).
--
-- Orden de rollout: esta migración se aplica a prod ANTES de mergear el código que escribe claves
-- nuevas (sin ella, el INSERT de la sync falla por el CHECK).
--
-- Reversa (en una migración NUEVA 0060, nunca editar ésta; antes revertir el código del CRM para
-- que nada vuelva a escribir claves nuevas):
--   DELETE FROM "catalog_atributos" WHERE "clave" = 'leds_rollo';
--   ALTER TABLE "catalog_atributos" DROP CONSTRAINT "catalog_atributos_clave_check";
--   ALTER TABLE "catalog_atributos" ADD CONSTRAINT "catalog_atributos_clave_check" CHECK ("clave" IN ('potencia_w', 'temperatura_k', 'tono', 'ip', 'flujo_lm', 'tension_v', 'zocalo', 'corriente_a', 'polos', 'seccion_mm2', 'medidas_mm', 'color', 'poder_corte_ka', 'curva', 'sensibilidad_ma', 'largo_m', 'montaje', 'angulo_grados', 'leds_m', 'potencia_w_m'));

ALTER TABLE "catalog_atributos" DROP CONSTRAINT "catalog_atributos_clave_check";
--> statement-breakpoint
ALTER TABLE "catalog_atributos" ADD CONSTRAINT "catalog_atributos_clave_check" CHECK ("clave" IN ('potencia_w', 'temperatura_k', 'tono', 'ip', 'flujo_lm', 'tension_v', 'zocalo', 'corriente_a', 'polos', 'seccion_mm2', 'medidas_mm', 'color', 'poder_corte_ka', 'curva', 'sensibilidad_ma', 'largo_m', 'montaje', 'angulo_grados', 'leds_m', 'potencia_w_m', 'leds_rollo'));
