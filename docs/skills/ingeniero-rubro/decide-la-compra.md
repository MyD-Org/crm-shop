# Qué dato decide la compra, por tipo de producto

El dato que un vendedor pregunta primero ("¿de cuántos amperes?", "¿rosca común o dicroica?"). Sirve
para: ordenar facetas, decidir qué medida vale como filtro duro, qué atributo cargar primero y qué
falta en el nombre del producto.

Claves existentes (`DEFINICION_ATRIBUTOS` del admin; facetables las de `REGISTRO` del Shop):
`potencia_w`, `temperatura_k`, `tono`, `ip`, `flujo_lm`, `tension_v`, `zocalo`, `corriente_a`,
`polos`, `seccion_mm2`, `medidas_mm`, `color`, `poder_corte_ka`, `curva`, `sensibilidad_ma`,
`largo_m`, `montaje`, `angulo_grados`, `leds_m`, `potencia_w_m`, `leds_rollo`, `diametro_mm`,
`ancho_mm`. No facetables hoy: `medidas_mm`, `leds_m`, `potencia_w_m`, `leds_rollo`.

"Sin clave" = el dato importa pero no existe como atributo (va en el nombre o es candidato a clave
nueva; una clave nueva es migración del CRM + contrato, no se agrega de paso).

## Protecciones (tablero)

| Tipo | Decide (en orden) | Notas del rubro |
|---|---|---|
| Interruptor termomagnético | `corriente_a`, `polos`, `curva`, `poder_corte_ka`; `montaje` = din | Serie IEC: 6, 10, 16, 20, 25, 32, 40, 50, 63 A. Vivienda: curva C, 3 o 4,5 kA; 1P+N cuenta como 2 polos en la práctica |
| Interruptor diferencial | `corriente_a`, `polos` (2 o 4), `sensibilidad_ma` | 30 mA = protección de personas (vivienda); 300 mA = incendio/industrial. Clase AC/A: sin clave |
| Caja moldeada | `corriente_a`, `polos` (3 o 4), `poder_corte_ka` | 100 A en adelante; regulable (rango) o fija: sin clave |
| Guardamotor | Rango de regulación (A) → `corriente_a`; `poder_corte_ka` | La potencia del motor (kW/HP) es referencia, **no** `potencia_w` |
| Contactor | `corriente_a` (AC-3), tensión de bobina, `polos`/contactos auxiliares | `tension_v` del contactor suele ser la bobina; sin clave propia |
| Relé térmico | Rango en A | Va con el contactor del mismo tamaño |
| Protector de tensión | `corriente_a` (o potencia admisible), `montaje` (din / enchufable) | |
| Descargador | `polos`, corriente de descarga (kA, sin clave), `tension_v` | |
| Gabinete / tablero | Cantidad de módulos/bocas (sin clave), `montaje` (embutir/aplicar), `ip`, `medidas_mm` | "Tablero 12 bocas" = capacidad |

## Llaves, tomas y conexión

| Tipo | Decide | Notas |
|---|---|---|
| Tecla / módulo | Línea (compatibilidad con bastidor y tapa — sin clave), función (punto, combinación, pulsador, toma — sin clave), `color` | 10 A típico; teclas smart: wifi/RF/kinetic (sin clave) |
| Tomacorriente | `corriente_a` (10 o 20 A), tipo (2P+T IRAM, universal — sin clave), `ip` si es exterior | 20 A para aire acondicionado, horno, termotanque |
| Ficha (macho) | `corriente_a` (10/20 A), tipo (2P+T) | |
| Zapatilla / prolongador | Cantidad de tomas (sin clave), `largo_m`, con/sin interruptor o protección (sin clave) | |
| Dimmer | `potencia_w` admisible, compatibilidad LED (sin clave) | |
| Sensor de movimiento / fotocélula | `angulo_grados`, `potencia_w` admisible, `montaje`, `ip` | |

## Cables y canalización

| Tipo | Decide | Notas |
|---|---|---|
| Cable unipolar | `seccion_mm2`, `color`, `largo_m` (rollo) | Serie: 1; 1,5; 2,5; 4; 6; 10 mm². Uso: 1,5 iluminación, 2,5 tomas, 4–6 alimentación/aire. Colores: celeste neutro, verde-amarillo tierra, marrón/negro/rojo fases |
| Cable taller (TPR) | Conductores × `seccion_mm2` ("3x1,5"), `largo_m` | La cantidad de conductores no es clave |
| Cable subterráneo | Conductores × `seccion_mm2` | |
| Cordón paralelo | `seccion_mm2`, `color` | |
| Caño corrugado / rígido | `diametro_mm` (o pulgadas: 3/4" ≈ 20–22 mm, 7/8", 1"), material (sin clave) | En la calle se pide en pulgadas o en mm |
| Accesorios de caño (curva, cupla, conector) | `diametro_mm` | Tiene que coincidir con el caño |
| Bandeja portacables | `ancho_mm`, ala/alto ("100/50" = ancho 100 × ala 50), tipo (perforada, escalera, lisa — sin clave) | Tapa y accesorios por ancho |
| Cablecanal | `medidas_mm` (ancho × alto), con/sin adhesivo | |
| Caja de paso / de luz | Forma (octogonal, rectangular, cuadrada), `medidas_mm`, embutir/aplicar | |
| Jabalina | `largo_m` (1; 1,5; 2 m), diámetro (pulgadas) | Con tomacable y caja de inspección |

## Iluminación

| Tipo | Decide | Notas |
|---|---|---|
| Lámpara (bulbo) | `zocalo` (E27 rosca común, E14 rosca fina), `potencia_w`, `tono`/`temperatura_k` | Equivalencia de la calle: "9 W LED ≈ 60 W de las viejas". Cálido ≤ 3500 K, neutro ≤ 5000 K, frío > 5000 K |
| Dicroica | `zocalo` (GU10 220 V / MR16 12 V), `potencia_w`, `tono`, `angulo_grados` | MR16 necesita trafo/driver de 12 V |
| Tubo LED | Largo (60 / 120 cm: `largo_m` 0,6 / 1,2), `potencia_w` (9 / 18 W), `tono`, conexión (un/dos extremos — sin clave); zócalo G13 | Reemplaza al fluorescente de 18/36 W |
| Panel / plafón | `potencia_w`, `medidas_mm` o diámetro, `montaje` (embutir/aplicar), `tono` | "60x60" = panel de 600 × 600 mm (cielorraso) |
| Embutido / spot | Diámetro de corte (sin clave), `zocalo` si lleva lámpara, `potencia_w`, `tono` | |
| Reflector | `potencia_w`, `ip`, `tono`, `flujo_lm` | Exterior: IP65 o más |
| Campana industrial | `potencia_w`, `flujo_lm`, `ip`, `angulo_grados` | |
| Tira LED | `tension_v` (12 / 24 / 220 V), `potencia_w_m`, `leds_m`, `ip`, `tono`, `largo_m` (rollo) | Siempre pregunta por la fuente |
| Fuente / driver | `tension_v` de salida, `potencia_w`, `ip` | Potencia de la fuente ≥ consumo de la tira × 1,2 |
| Luz de emergencia | Autonomía (h — sin clave), cantidad de LED, permanente/no permanente (sin clave) | |
| Aplique / colgante / velador | `zocalo`, `montaje`, `color`, `ip` si es exterior | |

## Otros

| Tipo | Decide | Notas |
|---|---|---|
| Multímetro / pinza | Categoría de medición, funciones (sin clave) | Sus rangos (600 V, 400 A) no son `tension_v` ni `corriente_a` |
| Extractor | Diámetro de boca (100/150 mm — hoy sin clave en extractores), caudal | |
| Ventilador | Tipo (techo, pie, pared), diámetro de aspas | |
| Calefactor | `potencia_w` | |
