-- Dimerizable y módulos (cambio `atributos-dimerizable-modulos`): el vocabulario cerrado de
-- `catalog_atributos.clave` pasa de 23 a 25 claves.
--
-- Nuevas (se agregan al final; el orden de las 23 existentes no cambia):
--   dimerizable (texto, `valor_texto` ∈ 'si' | 'no': la lámpara, panel, tira o driver regula su luz con un dimmer)
--   y modulos (numérica entera, `valor_num`: cantidad de módulos DIN de un gabinete, caja o tablero).
--   Los vocabularios y rangos (dimerizable si/no; módulos 1–200) viven en código (CRM y Shop), no en el CHECK.
--
-- Aditiva: el CHECK nuevo es más permisivo. No cambia columnas ni GRANT (el GRANT por columna de
-- 0049 ya cubre las filas nuevas). Las filas existentes no se tocan. El migrador corre las dos
-- sentencias en una transacción: no hay ventana sin CHECK.
--
-- Drift que vive SOLO en SQL (como 0049, 0053, 0058, 0059 y 0070): el CHECK de `clave` no está en src/db/schema.ts.
-- El snapshot 0072 es igual al 0071 (solo encadena id/prevId).
--
-- Orden de rollout: esta migración se aplica a prod ANTES de abrir el PR del admin y de mergear el
-- código que escribe claves nuevas (sin ella, el INSERT de la sync falla por el CHECK).
--
-- Reversa (en una migración NUEVA, nunca editar ésta; antes revertir el código del CRM para
-- que nada vuelva a escribir claves nuevas):
--   DELETE FROM "catalog_atributos" WHERE "clave" IN ('dimerizable', 'modulos');
--   ALTER TABLE "catalog_atributos" DROP CONSTRAINT "catalog_atributos_clave_check";
--   ALTER TABLE "catalog_atributos" ADD CONSTRAINT "catalog_atributos_clave_check" CHECK ("clave" IN ('potencia_w', 'temperatura_k', 'tono', 'ip', 'flujo_lm', 'tension_v', 'zocalo', 'corriente_a', 'polos', 'seccion_mm2', 'medidas_mm', 'color', 'poder_corte_ka', 'curva', 'sensibilidad_ma', 'largo_m', 'montaje', 'angulo_grados', 'leds_m', 'potencia_w_m', 'leds_rollo', 'diametro_mm', 'ancho_mm'));

ALTER TABLE "catalog_atributos" DROP CONSTRAINT "catalog_atributos_clave_check";
--> statement-breakpoint
ALTER TABLE "catalog_atributos" ADD CONSTRAINT "catalog_atributos_clave_check" CHECK ("clave" IN ('potencia_w', 'temperatura_k', 'tono', 'ip', 'flujo_lm', 'tension_v', 'zocalo', 'corriente_a', 'polos', 'seccion_mm2', 'medidas_mm', 'color', 'poder_corte_ka', 'curva', 'sensibilidad_ma', 'largo_m', 'montaje', 'angulo_grados', 'leds_m', 'potencia_w_m', 'leds_rollo', 'diametro_mm', 'ancho_mm', 'dimerizable', 'modulos'));
