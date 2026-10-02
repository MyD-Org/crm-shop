# Atributos desde PDF: lectura local + verificación

Sin API de Anthropic y sin base en la verificación. Los subagentes de Claude Code (modelo haiku) leen
los PDFs locales y escriben JSONL; el código decide qué se acepta.

## Carpeta de trabajo (`<dir>`, fuera de git)

```
<dir>/indice.json        [{archivo, bytes, productos:[{id, code, nombre, marca}]}]
<dir>/pdfs/<archivo>     PDFs originales
<dir>/recortes/<archivo> PDFs recortados por producto
<dir>/lectura/crudo/*.jsonl   lo que escribe cada subagente (entrada del verificador)
<dir>/lectura/aceptados.jsonl y descartes.jsonl   salida del verificador
```

## Formato de `crudo/*.jsonl` (una línea por producto)

```json
{"id":"123","pdf":"pdfs/catalogo.pdf","fila":"EFLG2-20W","atributos":{"potencia_w":{"valor":20,"cita":"Potencia 20W"}}}
```

- `id`: el de `indice.json`. `pdf`: ruta relativa a `<dir>` (no puede salir de `<dir>`).
- `fila`: identificador LITERAL de la fila o de la columna de la variante: el modelo o el código tal como
  figura en el PDF (en una tabla transpuesta es el encabezado de columna). `null` sólo si el PDF es la
  ficha propia de UN producto. En catálogos compartidos y en `recortes/` la fila es obligatoria (salvo
  para color, montaje, tono, curva y zócalo si el PDF tiene un único término de esa clave).
- `atributos`: `{clave: {valor, cita}}` con las claves de `CLAVES_ATRIBUTO`. **`cita` es opcional e
  informativa** (no decide nada): sirve para que quien revise vea de dónde salió. No incluir claves sin
  evidencia: no inferir.

## Cómo decide `verificar-atributos-pdf.ts` (evidencia posicional)

Se extraen los items de texto de cada página con sus coordenadas (pdfjs vía unpdf) y se reconstruyen
líneas (misma `y`) y columnas (alineación por `x`). Las tablas de los catálogos salen por celdas, así
que el encabezado y el valor no son texto contiguo: por eso no se exige la cita literal.

1. El valor tiene que estar en el PDF: número + unidad (coma o punto: `65W`, `1.100 lm`, `200 - 240VCa`,
   `IP 20` con el rótulo de su línea, `300 x 1200 mm`) o el término del vocabulario / un sinónimo.
2. Ficha propia de un producto (`pdfs/<archivo>` con un solo producto en `indice.json`): se acepta si es
   el único valor de esa magnitud en el PDF. Si hay varios valores distintos (p. ej. `3000 K - 6500 K`),
   hace falta `fila` y la regla 3. Color, montaje, tono, curva y zócalo se aceptan con un único término
   de la clave en el PDF.
3. Tabla o variantes: la `fila` tiene que coincidir con el producto (su código de Alegra sin sufijo de
   marca, o el modelo que el código de Alegra extiende, o todos los tokens número+unidad del nombre en las
   celdas de esa fila/columna) y el valor tiene que estar en la misma línea que el identificador de la
   fila (tabla normal) o en la misma columna (tabla transpuesta: se detecta porque hay otros
   identificadores de la misma forma en su línea, y cada celda va al encabezado más cercano por `x`).
   Si la `fila` es el código de Alegra con sufijo de marca (`-XYZ`), se busca en el PDF sin el sufijo
   (con separadores opcionales y sin el prefijo duplicado). Para el montaje, "superficie" / "de
   superficie" / "sobrepuesto" cuentan como "aplicar". En un PDF con más de un producto, el vocabulario
   (color, montaje, tono, curva, zócalo) también tiene que estar en la fila/columna del producto
   (`termino_fuera_de_fila`); el "único término" sólo vale en la ficha de un solo producto. Un número que
   es parte de un rango o de una lista con barra con la misma unidad ("1.400-1.500 Lm", "3000/4000K") se
   descarta (`valor_en_rango_o_lista`), y una tensión suelta contra un rango, también (`tension_parcial`).
4. Si el nombre ya dice otro valor para la misma clave: se descarta el del PDF (`contradice_nombre`).
   **Color de la luz**: para `color`, si el término figura tras "luz", "tipo de luz", "color de luz",
   "light" o "luz de color" (en su celda, su línea o el encabezado de su columna), se descarta
   (`color_de_luz`): es el color de la luz, no del producto. Si el producto es una fuente de luz de color
   (RGB, tira, cinta, lámpara), el color sólo se acepta con rótulo carcasa, cuerpo, terminación, acabado o
   "color"; ante la duda, se descarta.
   **Montaje**: si el PDF tiene un rótulo "Tipo de instalación", "Instalación", "Montaje" o "Aplicación",
   el valor tiene que ser el de esa celda/fila; "Corte embutido", "Compatible con … embutir" y "para
   embutir paneles" no son evidencia de montaje (`montaje_fuera_de_rotulo`).
   **Tono RGB/RGBW**: no se acepta si el nombre es un accesorio (conector, controlador/a, control remoto,
   cable, fuente, amplificador, empalme, clip, perfil, difusor): `tono_en_accesorio`.
   **Ángulo**: sólo si el rótulo de su fila/columna o su celda habla de ángulo, apertura o haz ("Beam
   angle"); "giro", "rotación", "inclinación", "orientable" y "basculante" se descartan
   (`angulo_no_es_de_luz`).
   **Por metro** (`leds_m`, `potencia_w_m`): el "/m" tiene que estar en el texto ("60 LED/m", "120 LEDs/m",
   "Leds/Mts", "14.4 W/m", "9,6 W/Mt", "por metro"); "60 LED" o "14 W" sin "/m" se descartan
   (`unidad_no_en_texto`). La potencia por metro nunca es `potencia_w`: ahí se sigue descartando
   (`valor_por_metro`).
   Una potencia o corriente "máxima" (carga admitida de un riel, controlador o tecla: "200W Máx", "Carga máxima 200W",
   "Potencia máxima de lámpara: 60W", "hasta 60W") no es la del producto: si "máx", "máximo/a", "maximum" o "hasta" está en su
   celda, en el rótulo de su fila o columna o en la celda pegada de la misma línea, se descarta (`valor_maximo`).
5. PDF sin capa de texto: `sin_texto`. Rangos y vocabularios de `normalizarAtributos`: `valor_invalido`.

Dos lecturas distintas del mismo (producto, clave) se descartan (`conflicto_entre_lecturas`).

Endurecimientos (preferimos perder un dato a cargar uno dudoso):

- **Ambigüedad en la fila/columna** (`ambiguo_en_fila`): si dentro de la fila o columna del producto hay más de un valor distinto de la misma
  magnitud (p. ej. 1100 lm y 1200 lm para cálido/frío), sólo se acepta si el nombre del producto dice temperatura o tono y coincide con el
  encabezado de la subcolumna del valor (el más cercano por `x`, sin empate). Para temperatura y tono alcanza con que el nombre diga lo mismo.
- **Valor único en ficha propia con varias páginas**: tiene que estar en una página donde figura el producto (su código de Alegra o todos los
  tokens número+unidad del nombre). Si el producto no figura en ninguna página (`producto_no_ubicado`) o el valor está en otra
  (`valor_en_otra_pagina`), se descarta; con un PDF de una sola página no se exige.

`aceptados.jsonl` trae, además del valor: `regla` (`unico` | `vocabulario` | `fila`), `evidencia` (texto
del PDF que lo respalda), `pagina` y `citaEnTexto` (si la cita del modelo aparece textual).

## Comandos (parado en `apps/admin`)

```
npx tsx scripts/verificar-atributos-pdf.ts --dir <dir>
npx tsx --env-file-if-exists=.env.local scripts/aplicar-atributos-pdf.ts --desde <dir>/lectura/aceptados.jsonl --tenant <id>            # dry-run
npx tsx --env-file-if-exists=.env.local scripts/aplicar-atributos-pdf.ts --desde <dir>/lectura/aceptados.jsonl --tenant <id> --aplicar
```

El aplicador sube con fuente `pdf` y respeta manual > pdf > nombre. Revisar `descartes.jsonl` y una
muestra de `aceptados.jsonl` (campo `evidencia`) antes de aplicar.
