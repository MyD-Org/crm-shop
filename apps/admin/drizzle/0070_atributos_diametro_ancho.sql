-- Diámetro y ancho (cambio `atributos-diametro-ancho`): el vocabulario cerrado de
-- `catalog_atributos.clave` pasa de 21 a 23 claves.
--
-- Nuevas (se agregan al final; el orden de las 21 existentes no cambia):
--   diametro_mm (diámetro en mm de caños, tubos, conectores, uniones, curvas, grampas de caño y cablecanal
--   redondo) y ancho_mm (ancho en mm de bandejas portacables y sus tapas y accesorios). Las dos son numéricas
--   (`valor_num`). Los rangos (diámetro 5–200, ancho 30–1000) viven en código (CRM y Shop), no en el CHECK.
--   Revierte la exclusión de "diámetro" del 2026-10-01 (decisión de la usuaria del 2026-10-06).
--
-- Aditiva: el CHECK nuevo es más permisivo. No cambia columnas ni GRANT (el GRANT por columna de
-- 0049 ya cubre las filas nuevas). Las filas existentes no se tocan. El migrador corre las dos
-- sentencias en una transacción: no hay ventana sin CHECK.
--
-- Drift que vive SOLO en SQL (como 0049, 0053, 0058 y 0059): el CHECK de `clave` no está en src/db/schema.ts.
-- El snapshot 0070 es igual al 0069 (solo encadena id/prevId).
--
-- Orden de rollout: esta migración se aplica a prod ANTES de mergear el código que escribe claves
-- nuevas (sin ella, el INSERT de la sync falla por el CHECK).
--
-- Reversa (en una migración NUEVA, nunca editar ésta; antes revertir el código del CRM para
-- que nada vuelva a escribir claves nuevas):
--   DELETE FROM "catalog_atributos" WHERE "clave" IN ('diametro_mm', 'ancho_mm');
--   ALTER TABLE "catalog_atributos" DROP CONSTRAINT "catalog_atributos_clave_check";
--   ALTER TABLE "catalog_atributos" ADD CONSTRAINT "catalog_atributos_clave_check" CHECK ("clave" IN ('potencia_w', 'temperatura_k', 'tono', 'ip', 'flujo_lm', 'tension_v', 'zocalo', 'corriente_a', 'polos', 'seccion_mm2', 'medidas_mm', 'color', 'poder_corte_ka', 'curva', 'sensibilidad_ma', 'largo_m', 'montaje', 'angulo_grados', 'leds_m', 'potencia_w_m', 'leds_rollo'));

ALTER TABLE "catalog_atributos" DROP CONSTRAINT "catalog_atributos_clave_check";
--> statement-breakpoint
ALTER TABLE "catalog_atributos" ADD CONSTRAINT "catalog_atributos_clave_check" CHECK ("clave" IN ('potencia_w', 'temperatura_k', 'tono', 'ip', 'flujo_lm', 'tension_v', 'zocalo', 'corriente_a', 'polos', 'seccion_mm2', 'medidas_mm', 'color', 'poder_corte_ka', 'curva', 'sensibilidad_ma', 'largo_m', 'montaje', 'angulo_grados', 'leds_m', 'potencia_w_m', 'leds_rollo', 'diametro_mm', 'ancho_mm'));
