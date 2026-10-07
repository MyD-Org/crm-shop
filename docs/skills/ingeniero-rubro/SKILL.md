---
name: ingeniero-rubro
description: Razonar como ingeniero en electricidad e iluminación (rubro eléctrico argentino) al tocar la búsqueda o el catálogo del Shop (apps/clientes) — sinónimos, diccionario, términos de contexto, medidas, categorías, atributos/características (catalog_atributos, facetas), el banco de búsquedas o la extracción de atributos del admin — y al revisar búsquedas reales de clientes. Trae glosario rioplatense, confusiones a evitar, qué dato decide la compra por tipo de producto y el proceso obligatorio (banco antes/después) para cualquier cambio de búsqueda.
---

# Ingeniero del rubro

Objetivo: que lo que un cliente escribe en la tienda **encuentre el producto que un electricista o un
vendedor de mostrador le daría**, con palabras de la calle, abreviaturas y medidas a medio escribir.
Antes de tocar código, preguntarse: *¿qué está comprando esta persona y qué dato elige entre dos
productos parecidos?*

## Cuándo usarla

- Al tocar `apps/clientes/src/lib/busqueda-v2/**` (en especial `entender/sinonimos.ts`,
  `diccionario.ts`, `terminos.ts`, `medidas.ts`), `busqueda-inteligente/**` o el banco
  (`busqueda-v2/__banco__/banco.json`).
- Al tocar características y facetas: `catalogo-facetas-registro.ts`, `catalogo-atributos-medida.ts`,
  `catalogo-caracteristicas.ts` (Shop) o `apps/admin/src/lib/catalogo-atributos-extraccion.ts` (claves,
  rangos y vocabularios).
- Al decidir categorías, nombres de producto o qué cargar como dato en el admin.
- Al revisar búsquedas reales (sección «Revisión periódica»).

## Archivos de referencia (leer el que haga falta, no todos)

| Archivo | Para qué |
|---|---|
| `glosario.md` | Cómo se dice en la calle → término del catálogo; si es sinónimo completo o sólo relacionado; si ya está en `SINONIMOS`. |
| `confusiones.md` | Palabras ambiguas y lecturas equivocadas (con el caso real "tecla inalámbrica"). |
| `decide-la-compra.md` | Por tipo de producto: el dato que decide la compra y su clave (`corriente_a`, `zocalo`…). |
| `medidas.md` | Cómo se escriben las medidas en la calle y cómo las lee HOY `medidasDeConsulta` (con huecos medidos). |

## Cómo piensa el motor (lo mínimo para no romperlo)

- **Términos** (`terminos.ts`): las palabras recuperan en OR y ordenan; no filtran. Pesos: significativa
  1, sinónimo `PESO_EXPANSION` 0,7, medida/número 0,4, contexto (lugares, "luz", "led", verbos de
  pedido, unidades) 0,3. Una palabra de producto metida por error en `LUGARES`/`CONTEXTO` deja de
  buscar (p. ej. "taller" en "cable taller").
- **Sinónimos** (`sinonimos.ts`): claves normalizadas en SINGULAR (o frases); valores = COMIENZOS de
  palabra del catálogo ("termomagnet"). Son blandos: suman candidatos, nunca filtran. Sin marcas ni
  códigos. Unidireccionales salvo que se escriba la vuelta.
- **Diccionario** (`diccionario.ts`): propone categorías candidatas (todas las palabras o el sustantivo
  principal) y atributos explícitos ("cálido", "e27", "ip65"). Los sustantivos ambiguos
  (`interruptor`, `llave`) sólo proponen categoría si están **escritos**, no si llegan por sinónimo (#468).
- **Medidas** (`medidas.ts`): conservador; lee la consulta CRUDA. Confianza alta puede filtrar duro;
  media sólo ordena; baja no se usa. `NxM` sólo se interpreta con contexto (protección, cable, panel).
- **Atributos** (`catalog_atributos`): claves cerradas con rango (`DEFINICION_ATRIBUTOS` del admin). Una
  clave sólo es faceta si está en `REGISTRO` (cobertura ≥ 30 %, ≥ 2 valores, tope 6 grupos).

## Reglas de criterio

1. **Primero el dato, después la heurística.** Orden de preferencia ante un hallazgo:
   publicar/arreglar el producto o su nombre → cargar el atributo → sinónimo → término de contexto →
   regla nueva en el parser. Una heurística nueva necesita un caso del banco que la justifique.
2. **Sinónimo completo vs relacionado.** Sólo es sinónimo completo si un electricista aceptaría
   cualquiera de los dos productos ("térmica" = "termomagnética"). Si es "lo que también te puede
   servir" ("caño" → "cablecanal"), es relacionado: va como expansión blanda de una sola dirección y
   nunca propone categoría.
3. **Una palabra ambigua no arrastra categoría.** Si la palabra vive en dos familias (llave, interruptor,
   tubo, cinta, módulo, campana, regleta, fuente), resolver por la palabra que la acompaña, no por el
   sinónimo (ver `confusiones.md`).
4. **La medida tiene dueño.** Un número se interpreta por el tipo de producto: "2x20" en una térmica son
   polos × amperes, en un cable son conductores × sección, en un panel son centímetros. Sin contexto, no
   se interpreta. La potencia de un guardamotor, el rango de un multímetro o la bobina de un contactor
   no son el dato del producto que se filtra.
5. **No inventar.** Ante la duda, no leer la medida ni proponer la categoría: lo que falta lo cubre el
   texto; lo inventado filtra mal.
6. **Decisiones vigentes que no se rompen:** el header arranca limpio (sin local recordado); el panel
   de categorías muestra el árbol completo con total fijo por categoría; en medidas, los que cumplen van
   primero **sin excluir** al resto (claves discretas); desplegable y Enter devuelven el mismo set (el
   orden puede diferir).
7. **Repo público:** sin marcas de clientes, nombres de la empresa, URLs de producción, ids de tenant ni
   consultas reales en el código, el banco versionado o el PR. Ejemplos genéricos del rubro.

## Proceso obligatorio para un cambio de búsqueda

Todo cambio que altere qué se recupera, cómo se ordena o qué se filtra (sinónimos, contexto, diccionario,
medidas, orden, facetas) sigue estos pasos. La usuaria mergea enseguida: **la rama no lleva PR hasta
tener la medición**.

1. **Hipótesis escrita.** Consulta(s) concreta(s), qué devuelve hoy, qué debería devolver y por qué (en
   términos del rubro). Reproducir con un test unitario o un script de sondeo (`terminosDe`,
   `medidasDeConsulta`, `candidatos`) antes de cambiar nada.
2. **Cambio mínimo.** Preferir una entrada de datos (sinónimo, contexto) a una regla. Rama nueva desde
   `origin/main`, en un worktree; nunca apilar.
3. **Tests.** Parado en `apps/clientes`: `npm test` (proyecto unit; para iterar,
   `npm test -- src/lib/busqueda-v2/entender`) con el test nuevo del caso. Sumar el caso al banco (`banco.json`) si es una
   búsqueda representativa: genérica, sin marcas, con `categoria` y/o `debeIncluirEnTop24`.
4. **Banco antes/después.** Misma cabecera en las dos corridas. Antes = `origin/main` (worktree aparte);
   después = la rama. Desde `apps/clientes` del worktree correspondiente (con `node_modules`):

   ```bash
   ./node_modules/.bin/tsx --env-file=<ruta absoluta a apps/clientes/.env.local del checkout principal> \
     src/lib/busqueda-v2/__banco__/busqueda.ts \
     --tuberia=motor --superficie=catalogo --produccion --solo-visibles=si --medidas=si \
     --flags=busqueda-ia:on,catalogo-solo-visibles:on,busqueda-medidas:on \
     --json=tmp/busqueda/antes.json      # después: --json=tmp/busqueda/despues.json
   ```

   - **Nunca** leer, imprimir ni copiar `.env*` al worktree: sólo pasar la ruta con `--env-file`.
     `tmp/` está ignorado por git. El banco es sólo lectura.
   - Comparar **caso por caso** los `casos[]` de los dos JSON (por `idx`): `posicion`, `top24Ok`,
     `categoriaOk`, `atributosOk`, `zero`, `total`. Listar todo caso que cambie y explicar cada uno
     (mejora esperada / efecto colateral). Si hay medidas: `npm run banco:analizar-medidas -- tmp/busqueda/despues.json`.
   - Un efecto colateral no explicado = achicar el cambio (como en #468: la versión amplia rompía
     "calefactor para el baño" y quedó limitada a los sustantivos ambiguos).
5. **PR con números.** Título `fix|feat(clientes): …`; cuerpo: qué cambia, causa, medición (n, hit@24,
   hit@3, MRR, puntaje, zero; cantidad de casos distintos y cuáles), cómo probar en la tienda. Sin
   consultas reales ni nombres de productos del catálogo.

## Revisión periódica de búsquedas reales

**Fuentes (sólo lectura):**
- `shop.busqueda_interpretaciones` (caché de interpretaciones: `consulta_norm`, `resultado`, `fuente`,
  `hits`, `last_used_at`). Extraer con `npm run busqueda:extraer` (archivo local ignorado por git; no
  imprime consultas) — lo corre la usuaria o se corre con `--env-file` como arriba.
- Telemetría (PostHog, flag `tracking`): `busqueda_enviada` (consulta normalizada, total, etapa) y
  `busqueda_resultado_click` (posición del clic).

**Qué mirar, en este orden:**
1. **0 resultados** o total muy bajo para algo que el rubro vende.
2. **Primer resultado de otro tipo** de producto (pidió tecla, aparece una caja moldeada).
3. **Clic lejos** (posición > 8) en consultas frecuentes: el producto está pero mal ordenado.
4. **Palabras de la calle** que no están en `SINONIMOS` (comparar contra `glosario.md`).
5. **Medidas no leídas o mal leídas** (sondear con `medidasDeConsulta`; ver huecos en `medidas.md`).

**Cómo clasificar cada hallazgo** (una etiqueta por hallazgo; anotar consulta genérica, no la real):

| Clase | Señal | Acción |
|---|---|---|
| `sinonimo` | El producto existe y su nombre usa otra palabra | Entrada en `sinonimos.ts` (completo o relacionado) + test + banco |
| `dato` | El producto existe pero le falta el atributo o la categoría | Cargar en el admin (atributo, categoría, nombre); no tocar código |
| `publicar` | El producto existe en Alegra pero no está visible / no hay stock / no existe | Avisar a la usuaria: es decisión comercial |
| `orden` | Aparece, pero abajo de otro tipo | Revisar pesos/categorías candidatas; cambio con banco obligatorio |
| `medida` | La medida no se lee o se lee mal | Ajuste en `medidas.ts` con dorados + banco |
| `ruido` | Consulta sin intención de compra o fuera del rubro | Nada |

Entregar la revisión como tabla de hallazgos (clase, consulta genérica, causa, acción propuesta) y
proponer los cambios en lotes chicos, cada uno con su medición.
