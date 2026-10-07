# Medidas en la calle y cómo las lee hoy el motor

Lo que lee `medidasDeConsulta` (`busqueda-v2/entender/medidas.ts`) sobre la consulta CRUDA. Columna
"Hoy" medida el 2026-10-07 sobre `origin/main`; volver a sondear antes de proponer un cambio:

```ts
// script en el scratchpad, corrido con el tsx de apps/clientes (sin base ni .env)
import { medidasDeConsulta } from "<worktree>/apps/clientes/src/lib/busqueda-v2/entender/medidas";
console.log(medidasDeConsulta("termica 2x20"));
```

Confianza: **alta** puede filtrar duro (los que cumplen primero, sin excluir); **media** sólo ordena;
**baja** no se usa. Contextos que habilitan lecturas: protección (`termic`, `termomagnetic`,
`disyuntor`, `diferencial`, `llave`, `interruptor`, `contactor`, `automatic`, `din`, `curva`…), cable
(`cable`, `conductor`, `cordon`), panel (`panel`, `gabinete`, `caja`, `bandeja`, `marco`), luminaria
(`lampara`, `foco`, `bulbo`, `dicroica`), telecom (`utp`, `cat 6`, `rj45`…).

## Cómo se escribe → qué significa → qué lee hoy

| En la calle | Significa | Hoy |
|---|---|---|
| "térmica 2x20", "termica bipolar 32a" | 2 polos, 20 / 32 A | polos=2, corriente_a=20/32 (alta) ✔ |
| "termica c16" | curva C, 16 A | curva=c, corriente_a=16 (alta) ✔ |
| "diferencial 2x40 30ma" | 2 polos, 40 A, 30 mA | polos=2, corriente_a=40, sensibilidad_ma=30 (alta) ✔ |
| "2x20" solo | ambiguo | nada (queda como texto/código) ✔ |
| "foco 9w e27 4000k", "9,5w" | 9 W, rosca E27, 4000 K | potencia_w, zocalo, temperatura_k (alta) ✔ (coma decimal sólo en la consulta cruda) |
| "dicroica 7w gu10" | 7 W, GU10 | potencia_w=7, zocalo=gu10 ✔ |
| "luz cálida", "luz de día" | tono | atributo explícito del diccionario (no es medida) ✔ |
| "reflector 50w ip65" | 50 W, IP65 | potencia_w=50, ip=65 ✔ |
| "tira led 12v 5m" | 12 V, rollo de 5 m | tension_v=12, largo_m=5 ✔ |
| "panel 60x60" | 600 × 600 mm | medidas_mm=600x600 (media; alternativa 60x60) ✔ |
| "jabalina 1,5m" | 1,5 m | largo_m=1.5 ✔ |
| "lampara 9" | ¿9 W? | potencia_w=9 (baja, no se usa) ✔ |
| "cable taller 3x1,5" | 3 conductores × 1,5 mm² | seccion_mm2=1.5 (media) ✔ — pero "taller" pesa como lugar (ver confusiones) |
| "3x2,5" solo | probablemente cable | nada (sin contexto) ✔ |
| **"cable unipolar 2,5"** | sección 2,5 mm² | **nada**: sin "mm"/"mm2" no lee la sección (el extractor del admin sí lee "UNIPOLAR 2.5") ✘ hueco |
| **"unipolar 2,5"** | cable de 2,5 mm² | **polos=1 (alta)**: "unipolar" sin "cable" se lee como polos ✘ lectura equivocada |
| **"caño 3/4"**, "caño 7/8", "1/2 pulgada" | diámetro en pulgadas | nada ✘ hueco (`diametro_mm` existe en datos) |
| **"caño 20mm"**, "corrugado 25" | diámetro 20 / 25 mm | nada: los mm sueltos sólo cuentan dentro de un cable ✘ hueco |
| **"bandeja 100/50"** | ancho 100 mm, ala 50 mm | nada ✘ hueco (`ancho_mm` existe en datos) |
| **"guardamotor 5,5kw"** | protege un motor de 5,5 kW | potencia_w=5500 (alta) ✘ lectura equivocada (no hay productos con esa potencia) |
| **"multimetro 600v"**, "pinza 400a" | rango de medición | tension_v=600 / corriente_a=400 (alta) ✘ lectura equivocada |
| **"contactor 25a bobina 220v"** | 25 A AC-3, bobina 220 V | corriente_a=25 ✔, tension_v=220 ✘ (es la bobina) |
| "rack 600x600 P.450" | ancho × alto × profundidad (mm) | nada (sin contexto de panel) — aceptable |
| "gabinete 12 modulos" | capacidad | nada — aceptable (sin clave) |
| "utp cat6 4p" | 4 pares | nada ✔ (contexto telecom) |

Los ✘ son **candidatos**, no órdenes: cada uno se trata con el proceso del `SKILL.md` (hipótesis →
test con dorados → banco antes/después). Primero mirar si el problema real existe en búsquedas reales
(si nadie escribe "guardamotor 5,5kw", no vale una regla).

## Formas de la calle a tener en cuenta

- **Coma decimal**: "2,5", "9,5w" (el parser la convierte; `normalizarConsulta` la rompe en dos tokens).
- **Pulgadas**: "3/4", "7/8", "1\"", "1 1/4", "media pulgada". En caños y jabalinas.
- **Polos en letras**: uni/bi/tri/tetrapolar, "2 polos", "1P+N", "3P+N", "4P".
- **Rangos**: "85-265V", "de 10 a 20w", "hasta 30w", "más de 1000 lm".
- **Equivalencias de lámpara**: "equivale a 60w", "60w de las viejas" (no es la potencia real).
- **Kelvin sin k**: "luz 3000", "6500" (no se lee: puede ser cualquier cosa).
- **Unidades pegadas a códigos**: "DL-18W", "TM-2x16": no son medidas (gate de código).
- **"x" por "por"**: "10 x 10", "2 x 1,5"; y "×".
- **Metros**: "x metro", "por metro", "rollo de 100", "100 mts".
