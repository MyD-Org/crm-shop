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
{"id":"123","pdf":"pdfs/catalogo.pdf","fila":"RF-20","atributos":{"potencia_w":{"valor":20,"cita":"RF-20 20W 1600LM IP65"}}}
```

- `id`: el de `indice.json`. `pdf`: ruta relativa a `<dir>` (no puede salir de `<dir>`).
- `fila`: identificador LITERAL de la fila o variante usada (modelo o código tal como figura en el PDF).
  `null` sólo si el PDF es la ficha propia de UN producto (`pdfs/<archivo>` con un único producto en
  `indice.json`); en catálogos compartidos y en `recortes/` la fila es obligatoria.
- `atributos`: `{clave: {valor, cita}}` con las claves de `CLAVES_ATRIBUTO`. `cita` es texto TEXTUAL del
  PDF (copiado, no parafraseado) que contiene el valor y la fila completa (incluye el identificador de
  la fila). No incluir claves sin evidencia: no inferir.

## Reglas que aplica `verificar-atributos-pdf.ts`

1. La cita (mayúsculas, sin tildes, espacios colapsados) aparece en el texto del PDF y contiene el
   valor, con su unidad o la palabra del campo (`IP65`, `25 A`, `E27`, sinónimos del vocabulario).
2. La fila aparece en el texto y coincide con el producto (contiene su código de Alegra sin sufijo de
   marca, o todos los tokens número+unidad del nombre: `20W`, `63A`, `300x1200`); la cita incluye la fila.
3. Si el nombre ya dice otro valor para la misma clave: se descarta el del PDF (`contradice_nombre`).
4. PDF sin capa de texto: no se carga nada (`sin_texto`).
5. Rangos y vocabularios de `normalizarAtributos` (`valor_invalido`).

Dos lecturas distintas del mismo (producto, clave) se descartan (`conflicto_entre_lecturas`).

## Comandos (parado en `apps/admin`)

```
npx tsx scripts/verificar-atributos-pdf.ts --dir <dir>
npx tsx --env-file-if-exists=.env.local scripts/aplicar-atributos-pdf.ts --desde <dir>/lectura/aceptados.jsonl --tenant <id>            # dry-run
npx tsx --env-file-if-exists=.env.local scripts/aplicar-atributos-pdf.ts --desde <dir>/lectura/aceptados.jsonl --tenant <id> --aplicar
```

El aplicador sube con fuente `pdf` y respeta manual > pdf > nombre. Revisar `descartes.jsonl` antes de aplicar.
