# Venta sin stock por modalidad — diseño

Fecha: 2026-10-26. Toca las dos apps (CRM: configuración y catálogo; Shop: exhibición, carrito, pedido).

## Intención

Hoy un producto sin stock disponible se muestra "Sin stock" y no se puede comprar. Central Led tiene
productos que **sí puede vender sin tenerlos**:

- Led Premium: se encargan al fabricante; la demora no es cierta (≈ una semana, "a coordinar").
  Se quiere que el comprador haga el pedido pero **sin pagar**: el pedido queda a confirmar y se
  coordina por contacto.
- Productos de Coresa (Macroled, etc.): sin stock físico, pero pedirlos al mayorista y recibirlos
  toma ≈ 48 h. Se quiere que se compren **como cualquier otro** (pago en línea) y que el comprador
  vea "Retiro en ~48 h" en vez de "Sin stock", distinguiéndolo del retiro inmediato.

El mecanismo tiene que ser **genérico y configurable desde el admin** (nada atado a una marca en el
código): el operador define "modalidades de venta sin stock", las activa o desactiva, y asigna
productos a una modalidad.

## Regla central

Una modalidad **sólo aplica cuando el producto no tiene stock disponible**. Con stock, el producto
se vende como hoy (esté asignado o no).

"Sin stock disponible" se mide con las reglas de sucursales que ya existen: la modalidad entra sólo
cuando **ninguna sucursal puede cubrir la línea** para esa entrega. Si otra sucursal lo tiene y el
traslado/respaldo está habilitado (`retiro_sin_stock`, `respaldo_envio`), manda lo de hoy ("retiro
en X días", "a traer de…") y no la modalidad. Si el traslado está apagado y la sucursal elegida no
lo tiene, se aplica la modalidad (se encarga al proveedor aunque otra sucursal lo tenga). Ese
mismo criterio tiene que regir en el catálogo, la cotización del carrito y la creación del pedido,
para que una línea no cambie de "normal" a "a pedido" entre el carrito y el pedido.

Sin stock disponible:

| Producto | Ve el comprador | Puede comprar | Pago |
|---|---|---|---|
| Sin modalidad, o con modalidad **inactiva** | "Sin stock" (como hoy) | No (como hoy) | — |
| Modalidad activa, flujo **en línea** | el texto de la modalidad (ej. "Retiro en ~48 h") | Sí | El de siempre (medios en línea, transferencia, etc.) |
| Modalidad activa, flujo **a confirmar** | el texto de la modalidad (ej. "A pedido") | Sí | No se cobra: el pedido queda a confirmar y se muestran los datos de contacto |

## Objetivos

- Modalidades por tenant, creadas y editadas en el admin: nombre interno, texto para el comprador,
  plazo, flujo de pago y un interruptor activa/inactiva.
- Asignar una modalidad a un producto (diálogo del producto) o a muchos (acción masiva del
  catálogo, con un filtro nuevo **por marca**).
- En el Shop, un producto sin stock con modalidad activa: se lista (no lo esconde "Solo con stock"
  ni lo hunde el orden de destacados), muestra el texto de la modalidad en card y ficha, y se puede
  agregar al carrito y comprar según su flujo.
- El operador ve en el pedido del CRM qué líneas van "a pedido" (para encargarlas).

## No objetivos (por ahora)

- Que una modalidad limite qué medios de pago se ofrecen (más allá de "en línea" vs "a confirmar").
- Plazos que cambian según el día de compra o ventanas de fechas (alcanza un plazo fijo).
- Encargar automáticamente al proveedor, o integrar stock del proveedor.
- Modalidades distintas por sucursal.

## Anti-objetivos (sería un fracaso aunque funcione)

- Cambiar en algo el comportamiento de un producto **sin** modalidad (con o sin stock), o de uno
  con modalidad **que tiene stock**.
- Mostrar "Sin stock" en un producto con modalidad activa, o cobrar en línea un pedido que tiene
  una línea "a confirmar".
- Nombres de marca, proveedor o plazos escritos en el código.
- Confiar en el navegador: el servidor resuelve la modalidad y su flujo al cotizar y al crear el
  pedido.

## Modelo de datos

### CRM (migración nueva en `apps/admin/drizzle/`, número libre ≥ 0094: 0089–0091 están tomados por ramas abiertas)

Tabla `modalidades_sin_stock` (per tenant, mismo estilo que `reglas_venta`):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | text NOT NULL → `tenants(id)` | |
| `nombre` | text NOT NULL | Interno, para el admin ("Coresa 48 h"). Único por tenant. |
| `texto` | text NOT NULL | Lo que ve el comprador en card y ficha ("Retiro en ~48 h", "A pedido"). Tope corto (≈ 40). |
| `plazo_dias` | integer NULL | Días hábiles hasta tener el producto. NULL = "a coordinar". CHECK 1..60. |
| `flujo` | text NOT NULL | CHECK `en_linea` \| `a_confirmar`. |
| `activa` | boolean NOT NULL DEFAULT true | Inactiva = los productos asignados se comportan como sin modalidad. |
| `created_at`, `updated_at` | timestamptz | |

Columna nueva `catalog_overlay.modalidad_sin_stock_id uuid NULL` → `modalidades_sin_stock(id)`
`ON DELETE SET NULL`.

GRANTs a `shop_app` (patrón de 0087 y 0045, condicionales a que exista el rol): `SELECT` sobre la
tabla nueva y `SELECT (modalidad_sin_stock_id)` sobre `catalog_overlay`. Comentario de cabecera
con la convención del repo (propósito, GRANT, drift que vive sólo en SQL, cómo revertir).

> Nombre: "etiqueta" ya se usa en el admin para los tags del catálogo (`shop_tags`). Esto se llama
> **modalidad de venta sin stock** en código y en la UI.

### Shop (migración nueva en `apps/clientes/drizzle/`, 0039)

`order_items.venta_sin_stock jsonb NULL`: snapshot de la modalidad aplicada a la línea al crear el
pedido — `{ modalidadId, nombre, texto, plazoDias, flujo }`. NULL = línea normal. Así el pedido
conserva qué se prometió aunque después cambie o se borre la modalidad. El espejo del admin
(`apps/admin/src/db/shop-schema.ts`) suma la columna.

Lectura en el Shop: declarar la tabla y la columna en `apps/clientes/src/db/crm.ts` (las columnas
sin GRANT rompen la consulta entera: desplegar la migración del CRM antes que el Shop, o leer la
columna aparte tolerando que falte, como ya se hace con otras columnas nuevas del CRM).

## Comportamiento en el Shop

### Estado del producto

`Product` suma `ventaSinStock?: { id, texto, plazoDias: number | null, flujo }`, presente sólo si
el producto tiene modalidad **activa** asignada (se resuelve en la consulta del catálogo junto con
el overlay). `stock` sigue significando el stock real.

Predicado único (en un módulo puro, usado por todas las superficies): un producto está
**"a pedido"** si `stock === "out"` y tiene `ventaSinStock`. Toda superficie que hoy hace
`stock === "out"` para bloquear o rotular pasa a usar "agotado de verdad" = `out` **sin** modalidad.

### Catálogo y listados

- El filtro "Solo con stock" (`conStock` en SQL y `derivarStock` en TS, que deben seguir
  coincidiendo) cuenta como listables a los productos "a pedido".
- `ordenDestacadosSql`: un producto "a pedido" pesa como uno de stock bajo, no como sin stock.
- "Más de…" (relacionados) y el autocompletado los incluyen.

### Card (home, catálogo, páginas de marca, favoritos)

- En lugar de "Sin stock": el `texto` de la modalidad, en tono neutro (no rojo). Se usa
  `stockLabel`/`showStock` de `ProductCard`; no hace falta release del DS.
- Botón "Agregar al carrito" habilitado (hoy `CatalogoProductos` y favoritos lo deshabilitan con
  `out`; `TarjetaProductoCarrusel` no).

### Ficha del producto

- Pill de estado con el `texto` de la modalidad (no "Sin stock").
- Botón "Agregar al carrito" habilitado (desktop y barra fija de mobile).
- Línea de entrega/plazo: con la disponibilidad por sucursal encendida, el motor
  (`sucursales-disponibilidad.ts`) suma un estado nuevo `por_pedido` (en envío y en retiro) con
  `demoraDias = plazoDias` (NULL → "a coordinar"), en el mismo lugar donde hoy devuelve
  `sin_stock`; los textos salen de `disponibilidad-textos.ts`. Con la disponibilidad por sucursal
  apagada, la ficha muestra el `texto` de la modalidad como única línea de plazo.
- Flujo a confirmar: se oculta el bloque de cuotas (no se cobra en línea) y se aclara, cerca del
  botón, que el pedido se confirma por contacto y no se cobra al comprar ("Se confirma por
  contacto; no se cobra al comprar"). El carrito repite el aviso cuando tiene una línea así.
- JSON-LD: `availability` = `BackOrder` para un producto "a pedido".
- Variantes: el selector no marca "Sin stock" en una variante "a pedido".

### Carrito y cotización

- `cotizacion.ts` no marca `sin_stock`/`stock_insuficiente` en una línea cuyo producto tiene
  modalidad activa; en su lugar la línea lleva `ventaSinStock` (resuelto en el servidor).
- Si la cantidad pedida supera el stock disponible (pero hay algo), **toda la línea** pasa a
  "a pedido" (con el plazo de la modalidad). No se parte la línea.
- El resumen de entrega del carrito/checkout toma el peor plazo de las líneas, como hoy.
- Las tres compuertas del servidor que hoy bloquean una línea sin stock (`cotizar` → 409,
  `disponiblesEnTx` → `StockInsuficienteError`, `origenDeLinea` → `sin_stock`) dejan pasar las
  líneas "a pedido" y siguen bloqueando todas las demás exactamente igual.

### Pedido

- La modalidad se vuelve a resolver en el servidor al crear el pedido (activa, flujo, plazo) y se
  guarda el snapshot en `order_items.venta_sin_stock` de cada línea "a pedido".
- **Flujo del pedido:** si alguna línea "a pedido" tiene flujo `a_confirmar`, **todo el pedido**
  queda a confirmar: el checkout **saltea el paso de pago** y el pedido sale con
  `pago_metodo = "a_coordinar"` (el slug reservado que ya existe para "ningún medio aplica"). Si
  todas las líneas "a pedido" son `en_linea`, el pedido sigue el checkout normal con todos sus
  medios.
- **Precio de un pedido a confirmar:** el total se cotiza con la **misma lista de precios que
  muestran las cards** (la del medio destacado, `mediosPrecio.destacado`; si no hay destacado, la
  general), para que coincida con lo que vio el comprador, también en las líneas con stock de un
  carrito mixto. Queda constancia en el pedido de qué lista se usó. Hoy `a_coordinar` cotiza con
  la lista general: esto cambia sólo para los pedidos a confirmar por modalidad.
- El pago se arregla en el contacto, fuera de la web. Un pedido a confirmar por modalidad no se
  puede pasar a un medio en línea desde la web (`/api/pedidos/[id]/medio` lo rechaza), y
  `pagoValidoConMedios` acepta `a_coordinar` en este caso aunque haya medios aplicables.
- Comprador con cuenta corriente: sin cambios, su pedido ya queda a confirmar con su medio de
  cuenta corriente; las líneas "a pedido" sólo suman su snapshot y su texto.
- Pantalla de confirmación, mail y Mi cuenta de un pedido a confirmar por modalidad: "Pedido
  recibido", sin cobro, y el bloque de contacto existente (`PedidoContacto`: plazo de contacto de
  `reglas_venta` y WhatsApp de la sucursal). Las líneas "a pedido" muestran su `texto` en el mail y
  en Mi cuenta.
- Reservas: la cantidad de una línea "a pedido" cuenta en `stock_reservado` como cualquier línea
  (la vista no cambia). Efecto aceptado: cuando entra stock, lo ya encargado aparece reservado.

### Asistente (chat IA)

`chat-ia-productos.ts`: un producto "a pedido" se informa al agente como disponible a pedido con su
`texto` (no "sin stock") y `available: true`.

## Admin (CRM)

- **Tarjeta "Venta sin stock"** en la página Envíos (junto a "Plazo de despacho"): lista de
  modalidades con su texto, plazo, flujo y un interruptor activa/inactiva; crear, editar y borrar
  (borrar deja a los productos sin modalidad).
- **Diálogo del producto** (`ProductoDialog`): select "Venta sin stock" con "Ninguna" + las
  modalidades (las inactivas, marcadas como tales).
- **Catálogo:** filtro nuevo por marca en `FiltrosAdmin` (sobre `catalog_products.brand`) y acción
  masiva "Asignar modalidad sin stock" (incluye "Ninguna"), por selección o por filtro, con el mismo
  mecanismo que las acciones masivas existentes.
- Todo cambio (modalidad o asignación) avisa al Shop como hoy (`avisarShop`) para que se refleje.
- **Pedido del CRM:** cada línea con `venta_sin_stock` muestra "A pedido · {nombre} · {plazo}"
  bajo el producto (como hoy "A traer de…"), y el aviso "Falta stock" no cuenta esas líneas
  (se muestra aparte: "N productos a pedido").
- Textos del admin y del Shop en usted (regla del repo).

## Lo que decidió Emanuel

- Configurable desde el admin, con posibilidad de activar/desactivar cada modalidad.
- Sólo aplica sin stock; con stock, todo como hoy.
- Sin modalidad: como hoy (sin stock no se compra).
- Por modalidad: o pago en línea normal, o pedido a confirmar con datos de contacto en vez de pago.
- Plazo fijo por modalidad (horas/días o "a coordinar"), sin ventanas de fechas.
- Carrito mixto con una línea a confirmar: todo el pedido queda a confirmar.
- Sin stock = ninguna sucursal puede cubrirlo con las reglas de traslado vigentes; con el traslado
  apagado y la sucursal elegida sin stock, aplica la modalidad.
- Pedido a confirmar: sin paso de pago, con el precio de la lista que muestran las cards, y el
  cierre "Pedido recibido, no se cobró nada, lo contactamos" con el WhatsApp.

## Decisiones del diseño (a revisar)

- Nombre "modalidad de venta sin stock" (evita "etiqueta", que ya existe).
- Plazo en **días hábiles** (el motor de entrega trabaja en días); el `texto` es libre, así que el
  comprador puede leer "~48 h".
- Una línea con cantidad mayor al stock pasa entera a "a pedido".
- Pedido a confirmar = `pago_metodo "a_coordinar"` (sin estado nuevo de pedido).
- Se permite una modalidad con plazo "a coordinar" y pago en línea (decisión del operador); el
  formulario del admin muestra un aviso al guardarla así.
- Sin feature flag: sin modalidades activas no cambia nada; el interruptor de cada modalidad es el
  corte.
- Peso en destacados igual a stock bajo.

## Queda para quien lo construya

- Cómo se resuelve la modalidad en las consultas del catálogo (join en la consulta vs. lectura
  aparte cacheada) y cómo se propaga a las claves de caché.
- Cómo se aplica a variantes agrupadas (el overlay se edita sobre el ancla del grupo: seguir el
  mismo criterio que `mostrar_marca`).
- Orden de despliegue de las migraciones y tolerancia a la columna ausente.
- Tests: caracterizar que un producto sin modalidad no cambia en ninguna superficie, y casos de
  carrito mixto, cantidad > stock, modalidad inactiva y modalidad borrada con pedidos existentes.
