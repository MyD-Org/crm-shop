# Campañas de precios (CRM → Shop)

Fecha: 2026-10-28 · Estado: propuesta, pendiente de aprobación de Emanuel · Apps: `apps/admin` (CRM) y `apps/clientes` (Shop) · Contrato CRM↔Shop: sí (vista `catalog_products_shop`).

## Por qué

La promo de lanzamiento (PR #694, sección "Promociones" de la home) mostró el límite del mecanismo actual: el precio de promoción se carga en el CRM como **ajustes de coeficiente por producto en cada lista de Precios online**. Eso obliga a:

- calcular coeficientes a mano (y dos por producto, uno por lista);
- acordarse de borrarlos al terminar (no vencen solos);
- tipear el precio habitual en la sección de la home para poder tacharlo, porque la tienda sólo ve el precio final.

Para un Black Friday con cientos de productos esto no escala: fuera de la sección de la home no habría tachado ni badge, y los ajustes quedarían olvidados.

## Qué es una Campaña

Un descuento con nombre y ventana horaria que se aplica **encima del precio normal** sin modificarlo:

- **Nombre** (p. ej. "Black Friday") y **etiqueta del badge** (por defecto, el nombre).
- **Inicio y fin** con fecha y hora de Argentina (`-03:00`); fin exclusivo.
- **Reglas**: alcance **producto**, **marca** o **categoría**, cada una con un **% de descuento** entero (1–90). Una regla de producto con **0 %** excluye ese producto (sirve para "toda la marca X menos este").
- Precedencia dentro de la campaña, igual que los ajustes de hoy: producto > marca > categoría más profunda.

Se activa y termina sola por fecha. No hay que deshacer nada: el precio normal nunca se tocó.

### Lo que esto saca de la gestión de hoy

- Cálculo de coeficientes.
- Ajustes duplicados por lista.
- Reversión a mano.
- Precio tachado tipeado.
- Tarea programada (ver "Cómo se activa sola").

### Ciclo de vida (sin estados manuales)

| Estado | Cuándo |
|---|---|
| Programada | ahora < inicio |
| Activa | inicio ≤ ahora < fin |
| Terminada | fin ≤ ahora |

No hay "borrador" ni "publicar". Una campaña programada es invisible para los clientes hasta su inicio, así que guardarla con anticipación ya es prepararla.

Acciones disponibles:

| Acción | Cuándo se puede | Qué hace |
|---|---|---|
| Editar | Programada o activa | Edición completa |
| Terminar ahora | Activa | Fin = ahora |
| Eliminar | Programada | Se borra |
| Ver | Terminada | Sólo lectura, para historial |

**Sin superposición (v1, decisión mía):** dos campañas del mismo tenant no pueden tener ventanas que se pisen. El CRM lo valida al guardar. Black Friday y Cyber Monday pegadas sí se pueden (fin de una = inicio de la otra).

## Reglas de precio

- **El mismo % se aplica a todas las listas públicas de Precios online** ("Tarjeta cuotas" y "Efectivo o Transferencia"). Es obligatorio, por dos motivos:
  - el Shop esconde la línea "$X con <medio>" cuando esa lista no queda por debajo de la general (`precioDeUnaLista`, `apps/clientes/src/lib/medios-precio.ts`);
  - el % que se exhibe tiene que valer contra cualquier precio normal que se muestre.
- Precio de campaña por lista, neto de IVA: `round(precio_normal_neto × (1 − pct/100), 2)`. El IVA lo suma el Shop como hoy (`precio-final.ts`).
  - Sin redondeo "psicológico", igual que los precios normales.
- El **% exhibido es el de la regla**. Es honesto porque el precio sale exactamente de aplicarlo al precio normal.
  - Respeta lo aprobado en el spec de la promo: % sólo contra nuestro precio habitual, en verde.
- **Listas privadas** (cuentas con precio propio): ver Decisiones abiertas, punto B.
  - Hoy esos clientes pagan siempre su precio privado (`cotizacion.ts:155-163`), aunque sea más alto que el público con descuento.
  - `aplicarEstadoPrecio` (`precios-cuenta-estado.ts:56-65`) borra `oldPrice` y `discount`, pero **no** `badge`. Sea cual sea la decisión, el badge de campaña tiene que caer cuando el precio que se cobra no es el de campaña.
- **Por debajo del costo:** el CRM lo permite, pero lo avisa (ver Decisiones abiertas). Los ajustes de hoy no pueden bajar del costo; una campaña sí.
- **Variantes:**
  - Una regla de producto sobre un producto que pertenece a un modelo (`grupo_id`) alcanza a todas las variantes del modelo (decisión mía).
  - Las reglas de categoría se resuelven con `coalesce(grupo_id, alegra_id)` contra `catalog_overlay`, igual que el Shop. Así no se escapan las variantes cuya categoría está cargada sólo en el ancla.
  - `calcular_precios_online` une por `alegra_id`; no copiar ese criterio.
- Los ajustes de Precios online siguen existiendo para lo que son: márgenes permanentes. La campaña se calcula sobre el precio que ya los incluye. Ya no se usan para promociones.

## Cómo viaja al Shop

### CRM: precio materializado

Tablas nuevas en `public` (migración del CRM; ver la nota de numeración más abajo):

- **`campanias`**: `id uuid`, `tenant_id`, `nombre`, `etiqueta`, `inicio timestamptz`, `fin timestamptz`, `creado_por`, timestamps.
  - CHECK `fin > inicio`.
  - Exclusión de superposición por tenant: `EXCLUDE USING gist (tenant_id WITH =, tstzrange(inicio, fin) WITH &&)` o validación equivalente.
- **`campania_reglas`**: `campania_id`, `tipo` (`producto` | `marca` | `categoria`), `alegra_id` | `marca` (normalizada `lower(btrim())`) | `categoria_id`, `pct smallint` (0–90). Índice único por campaña y objetivo.
- **Columna nueva en `catalog_products`**: `campanias_online jsonb`. Es un arreglo con las campañas **no terminadas** que alcanzan al producto, cada una así:

  ```json
  { "id": "<uuid>", "inicio": "<iso>", "fin": "<iso>", "pct": 20,
    "precios": [{ "idPriceList": "<id>", "price": 1234.56 }] }
  ```

  Sólo lleva listas públicas. Sin campañas, `NULL`.

**Cuándo se recalcula** la columna (función SQL hermana de `calcular_precios_online`, bajo el mismo advisory lock `precios_online:<tenant>`):

- Al guardar, editar, terminar o eliminar una campaña: los productos afectados.
- **Cada vez que se reescribe `precios_online`** (`aplicar_precios_online` en sus dos modos: sync de costos y aplicación de ajustes), porque el precio de campaña depende del normal.

- También al **cambiar en el catálogo del CRM la categoría, la marca o el grupo de variantes de un producto** (`app/api/admin/catalogo/productos/*`), sólo para ese producto o grupo. Hoy esos cambios no recalculan precios; sin esto, un producto recategorizado durante la campaña ganaría o perdería el descuento recién en el barrido diario (decisión mía).

Las entradas terminadas se conservan **24 h después del fin** (la ventana de pago de un pedido pendiente) y recién después se pueden podar. Que queden no hace daño, porque el Shop filtra por fecha.

**Vista y permisos:**

- `catalog_products_shop` agrega al final la columna `campanias_online`: `CREATE OR REPLACE` sólo agregando columnas, con el bloque de GRANT condicional de siempre.
- Vista nueva `campanias_shop` (`tenant_id, id, nombre, etiqueta, inicio, fin`) con SELECT para `shop_app`: campañas no terminadas o terminadas hace menos de 24 h (para recotizar pedidos pendientes, ver punto 4 del Shop).

**Contrato:**

- Actualizar `apps/clientes/src/db/crm.ts` y `__fixtures__/crm-contrato.json`.
- Actualizar el doc del contrato en `MyD-Org/platform` en el mismo cambio.

**Aviso al Shop:** después de cada guardado de campaña, `avisarShop`, como Precios online.

### Shop: la vigencia se decide en cada visita

Sigue el patrón de `flagsPublicos()`: se evalúa por request, afuera de `use cache`, y viaja como argumento.

1. **`campaniasVigentes()`** lee `campanias_shop`.
   - La lectura va cacheada con su propio tag, que vence con el aviso del CRM.
   - Fuera de la caché, con el reloj del servidor, devuelve las **ids activas ahora**, ordenadas, además del nombre, la etiqueta y el fin de cada una.
   - Deduplicado por request con `cache` de React.
2. Las ids activas son un **argumento** de `paginaCacheada`, `productoCacheado` y demás funciones de `catalogo-publico.ts` que arman precios. La clave de caché cambia sola en el minuto de inicio y de fin: **no hay cron ni aviso en los bordes**, y la vigencia nunca se calcula dentro de `use cache` (regla del spec de la promo).
3. **Una única función pura decide el precio**, por ejemplo `precioVigente(fila, idLista, idsActivas)`, y la usan tanto `precioDeLista` / `mapFilaToProduct` como `cotizarItem`.
   - Si la fila tiene una entrada de `campanias_online` cuya id está activa:
     - precio = el de campaña de esa lista;
     - `oldPrice` = el normal;
     - `discount` = "N % de descuento".
   - Si no, todo queda como hoy.
   - En el checkout, `idsActivas` se calcula con el mismo `campaniasVigentes()`. Lo exhibido y lo cobrado salen de la misma fila y la misma regla.
4. **Pedidos ya creados:**
   - El pedido congela `precio_unitario` como hoy, y la factura de Alegra lo toma de ahí sin cambios.
   - Al recotizar un pedido existente (`/api/pedidos/[id]/medio` y `/cuotas`), las ids activas se calculan con la **fecha de creación del pedido**. Así un pedido creado en campaña conserva su precio durante la ventana de pago de 24 h aunque cambie el medio (ver Decisiones abiertas).
5. **Orden, filtro y rango de precio del catálogo** también usan el precio vigente (decisión mía).
   - Hoy salen de SQL sobre el precio normal: `precioSql` y `precioExhibidoSql` (`apps/clientes/src/lib/catalog.ts:1202-1225`) alimentan `precio-asc/desc`, `precio_min/max` y el rango del slider.
   - Hace falta una expresión SQL `precioVigenteSql(idsActivas)` que tome de `campanias_online` el precio de la campaña activa o, si no hay, el normal. La usan el orden, el filtro y las facetas.
   - Sin esto, durante un Black Friday "hasta $50.000" dejaría afuera un producto que la card muestra a $45.000. Es el cambio más grande del lado del Shop.
6. **Borde inicio/fin:** si el cliente ve el precio de campaña a las 23:59:59 y confirma a las 00:00:01, sale el `409 precio_cambio` de siempre con el total nuevo. No se agrega ninguna gracia.

### Qué muestra el Shop

Todo el catálogo, no sólo la home. Se respetan las decisiones de UI ya aprobadas:

- **Cards** (grilla, búsqueda, carruseles, favoritos):
  - `oldPrice` tachado y `discount`, campos que `Product` y el `ProductCard` de `@myd-org/ui` ya tienen sin usar (ver Decisiones abiertas, punto A);
  - el tachado es el precio normal **de la misma lista** que muestra la card en grande, así que no se mezclan lista y transferencia;
  - badge con la etiqueta de la campaña y la pastilla verde del %, reusando `badgePromo`;
  - nada encima de las fotos en mobile, sin cuenta regresiva en cards.
- **Ficha:**
  - precio de campaña, normal tachado y "N % de descuento" en verde (reusar `PrecioPromo` con `esTransferencia` según el medio);
  - pastilla de cuenta regresiva "Termina el 5/11" y reloj al final (`CuentaRegresiva`), con el rojo sólo para la urgencia;
  - las líneas por medio de pago muestran su precio de campaña.
- **Carrito y checkout:**
  - cada línea con el normal tachado y el nombre de la campaña;
  - el resumen con "Usted ahorra $X" en verde;
  - `/api/carrito/cotizar` devuelve por línea el precio normal y la id de la campaña.
  - El mini-carrito (`CartPreview`) hoy muestra el precio guardado al agregar. No puede contradecir lo vigente, así que tiene que mostrar el precio cotizado o el del catálogo vigente.
- **SEO:** el `Offer` del JSON-LD lleva el precio de campaña y `priceValidUntil` = fin.
- **Chat IA y autocompletado:** pasan por `mapFilaToProduct`, así que muestran el precio vigente sin trabajo propio. Verificarlo.
- Textos en usted.

### Pedido

Migración del Shop: `order_items.campania_id` (nullable) y `order_items.precio_normal` (neto, nullable), sólo para trazabilidad. El detalle del pedido en el CRM muestra "Black Friday −20 %" en la línea.

## CRM: pantalla "Campañas"

Va dentro de Catálogo, junto a Precios online, con el mismo permiso (`requireAdminPlus`).

- **Listado:** nombre, ventana, estado y cantidad de productos.
- **Formulario:**
  - nombre, etiqueta, inicio y fin (hora de Argentina);
  - tabla de reglas (alcance + %), con alta múltiple de productos como hoy en `ListasPrecioPanel`.
- **Vista previa antes de guardar:**
  - productos alcanzados;
  - muestra de precio normal → campaña por lista;
  - cantidad de productos que quedan **por debajo del costo**, resaltados;
  - choque de fechas con otra campaña, que bloquea.
- **Historial:** cada guardado deja una entrada en `precios_online_cambios`. Hay que extender el CHECK de `tipo` con `campania`.
- En la grilla de Precios online, un indicador "En campaña" por producto.

## Sección "Promociones" de la home

Pasa a ser la **vidriera**: elige qué SKUs destacar y la estrella. El precio, el tachado y el fin salen de la campaña.

- Se quita del editor el campo `precioHabitual`. Si el contenido guardado lo trae y el producto no está en campaña, se sigue respetando: compatibilidad mientras dura la promo de lanzamiento cargada con ajustes.
- La sección puede asociarse a una campaña. Si lo está, su inicio y fin son los de la campaña.
  - El precio y el tachado de sus items vienen del servidor (`Product`).
  - El `PromoProvider` del navegador queda sólo para mostrar u ocultar la sección y para la cuenta regresiva. No decide precios.
- Escalera de comparación, unidades de la estrella y cuenta regresiva: sin cambios.
- Al salir las campañas, la promo de lanzamiento se pasa a una campaña y se borran sus ajustes.

## Fuera de alcance (v1)

- **Límite de unidades por producto a precio de campaña.** Exige un contador nuevo validado dentro de la transacción del pedido. Se mantiene la indicación de unidades reales de la estrella de la home, que el checkout no aplica.
- Precio final fijo por producto (sólo %).
- Campañas superpuestas.
- Descuentos sobre listas privadas.
- Campañas por medio de pago o por sucursal.
- Cupones.
- Banner global de campaña.
- Precio de campaña en el CRM fuera de la tienda: cotizaciones y asistente vendedor siguen con el precio normal.
  - Hoy `precios_online` sólo lo consumen las pantallas de precios del CRM, así que no hay otro lugar que se desalinee.

## No debe pasar

- Que el precio cobrado difiera del exhibido.
- Un % o un tachado que no sea contra nuestro precio normal real.
- Unidades infladas.
- Que una campaña terminada siga mostrando badge o descuento. Tampoco al revés: que una que empezó no se vea hasta que venza una caché.

## Restricciones

- Las migraciones del CRM se aplican a mano antes de mergear el código que las usa. La del Shop se aplica después de la del CRM.
- **Numeración:** usar el siguiente número libre al implementar. El PR #695 ya usa CRM 0094 y Shop 0039, así que hoy serían 0095 y 0040.
- El repo es público: fixtures sintéticos, dominios `.example`.

## Lo que queda al implementador

- La forma exacta de las funciones SQL: si el recálculo de campañas va dentro de `aplicar_precios_online` o en una función aparte llamada en los mismos puntos.
- La poda de entradas terminadas.
- Cómo se pasan las ids activas por las firmas de `catalogo-publico.ts`.
- El diseño fino de la pantalla del CRM.
- Cómo el mini-carrito obtiene el precio vigente.

## Decisiones abiertas (para Emanuel)

A. **Tachado en las cards.**
   - El spec de la promo lo descartó (`2026-10-26-promociones-home-design.md:199-201`): la card muestra en grande el precio de lista y el habitual era el de transferencia, así que mezclarlos confundía.
   - Con campañas el tachado es de la misma lista que el precio grande, así que esa confusión ya no existe.
   - Propuesta: tachado + % en las cards.

B. **Clientes con lista privada durante una campaña.**
   - Propuesta: pagan el menor entre su precio privado y el público de campaña. Ven badge y tachado sólo cuando gana el de campaña.
   - Alternativa (menos código): siempre su privado, sin badge, aunque le salga más caro que a un visitante anónimo.

C. **Pedido pendiente después del fin.**
   - Propuesta: conserva el precio de campaña durante las 24 h de pago, aunque se cambie el medio. Por eso la vista y la poda guardan la campaña 24 h más.
   - Alternativa: al recotizar vuelve al precio normal. Saca la gracia de 24 h de la vista y de la poda.

D. **Valores por defecto a confirmar:**
   - sólo % en v1, sin precio final fijo (el fijo es ambiguo: ¿qué lista?, ¿con o sin IVA?);
   - por debajo del costo, la vista previa avisa y pide confirmar, pero no bloquea;
   - el límite de unidades por producto queda para v2.
