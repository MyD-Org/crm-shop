-- Atributos por metro de las tiras LED (cambio `atributos-por-metro`): el vocabulario cerrado de
-- `catalog_atributos.clave` pasa de 18 a 20 claves.
--
-- Nuevas (se agregan al final; el orden de las 18 existentes no cambia): leds_m (cantidad de LED por
-- metro, entero: 60, 120) y potencia_w_m (potencia por metro en W/m: 4.8, 14.4). Ambas numéricas
-- (`valor_num`). Los rangos viven en código (CRM y Shop), no en el CHECK.
--
-- Aditiva: el CHECK nuevo es más permisivo. No cambia columnas ni GRANT (el GRANT por columna de
-- 0049 ya cubre las filas nuevas). Las filas existentes no se tocan. El migrador corre las dos
-- sentencias en una transacción: no hay ventana sin CHECK.
--
-- Drift que vive SOLO en SQL (como 0049 y 0053): el CHECK de `clave` no está en src/db/schema.ts. El
-- snapshot 0058 es igual al 0057 (solo encadena id/prevId).
--
-- Orden de rollout: esta migración se aplica a prod ANTES de mergear el código que escribe claves
-- nuevas (sin ella, el INSERT de la sync falla por el CHECK).
--
-- Reversa (en una migración NUEVA 0059, nunca editar ésta; antes revertir el código del CRM para
-- que nada vuelva a escribir claves nuevas):
--   DELETE FROM "catalog_atributos" WHERE "clave" IN ('leds_m', 'potencia_w_m');
--   ALTER TABLE "catalog_atributos" DROP CONSTRAINT "catalog_atributos_clave_check";
--   ALTER TABLE "catalog_atributos" ADD CONSTRAINT "catalog_atributos_clave_check" CHECK ("clave" IN ('potencia_w', 'temperatura_k', 'tono', 'ip', 'flujo_lm', 'tension_v', 'zocalo', 'corriente_a', 'polos', 'seccion_mm2', 'medidas_mm', 'color', 'poder_corte_ka', 'curva', 'sensibilidad_ma', 'largo_m', 'montaje', 'angulo_grados'));

ALTER TABLE "catalog_atributos" DROP CONSTRAINT "catalog_atributos_clave_check";
--> statement-breakpoint
ALTER TABLE "catalog_atributos" ADD CONSTRAINT "catalog_atributos_clave_check" CHECK ("clave" IN ('potencia_w', 'temperatura_k', 'tono', 'ip', 'flujo_lm', 'tension_v', 'zocalo', 'corriente_a', 'polos', 'seccion_mm2', 'medidas_mm', 'color', 'poder_corte_ka', 'curva', 'sensibilidad_ma', 'largo_m', 'montaje', 'angulo_grados', 'leds_m', 'potencia_w_m'));
