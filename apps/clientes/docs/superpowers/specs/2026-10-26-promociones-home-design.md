# Sección de promociones en la home — Design

_2026-10-26 · Brainstorming con Emanuel (decisiones de Claude marcadas como **[decisión de Claude]**)_

## Contexto

Central Led lanza la tienda online de Mar del Plata y quiere una **promo de lanzamiento agresiva**:
un producto estrella a un precio que no se consigue en otro lado, unas pocas ofertas más que lo
acompañan, fecha de fin y unidades limitadas. La promo se va a empujar con pauta paga en Instagram
(cuenta nueva, ~11 seguidores) y un sorteo; los anuncios llevan directo a la **ficha** del producto
estrella, no solo a la home.

Plan comercial acordado (los precios se fijan después, con el costo de reposición real):

- Estrella: ventilador de techo Noak Slim 42" (10 u en MdP, sin reposición hasta noviembre) →
  **solo 5 unidades a precio de apertura**; el resto sigue a precio normal.
- Acompañan: kit 3 veladores Candle, taladro atornillador Jadever, velador Fungus, panel plafón 24 W.
- Referencia de mercado: "visto en otras tiendas desde $X", sin nombrar la tienda, con capturas
  fechadas guardadas aparte.

Lo que ya hay en el Shop y condiciona el diseño:

- **El precio sale de los "Precios online" del CRM** (change `listas-precio-online`, migración
  0065 del admin): costo × coeficiente por lista. Hoy hay dos listas: la de referencia (`main`,
  "Tarjeta cuotas", coef. 1,6) y la de Transferencia (coef. 1,3), y la tienda muestra × 1,21 (IVA).
  "$X con Transferencia" es `precioMedio`. Online solo se cobra transferencia y efectivo (Payway y
  Mercado Pago inactivos). **El precio de promo se carga en el CRM con un ajuste por producto
  (`upsertOverride` tipo `producto`) en las dos listas**; el coeficiente mínimo es 1, así que nunca
  queda debajo del costo. La tienda no tiene precio propio de promo y este diseño **no** lo agrega.
  Como el precio es costo × coeficiente, si se aprueba un costo nuevo durante la promo el precio se
  mueve con él (aceptado).
- **No hay precio tachado, cupones ni etiquetas visibles.** `ProductCard` del DS ya acepta
  `oldPrice` y `badge` (`TarjetaProductoCarrusel`, `badgeProducto`), pero nadie los llena. La ficha
  (`ProductoClient`, bloque `PrecioConImpuestos`) no tiene badge ni precio de referencia.
- **Secciones de la home**: `HomeContent` en `src/data/home-defaults.ts`, una fila por clave en
  `shop.home_content`, validación en `erroresSeccion`, editores en `components/home/editores`, orden
  y visibilidad genéricos. La referencia más reciente de "agregar una sección de punta a punta" es
  `tiendaOficial` (PR #668 + `b5918715`).
- **Productos por SKU**: `destacadosHome` rellena hasta `cantidad` con otros productos (no sirve
  para una promo); debajo está `getProductosPorSkus` (`src/lib/catalog.ts`), sin caché y sin orden.
- **Video**: solo se embeben YouTube/Vimeo (`videoEmbebible`, `components/marcas/VideoMarca.tsx`,
  CSP ya abierta). No hay subida de video propio.
- **Stock**: `Product.stockQty` / `stock` (`in|low|out`) con la disponibilidad de `dispCatalogo()`
  (cualquier local activo). La card ya muestra "Quedan N" cuando hay poco.

## Goals

1. Una sección **"Promociones"** en la home, alta en la página, editable desde "Modo edición" sin
   deploy: textos, fechas, producto estrella, hasta 6 productos más, referencia de mercado, legales.
2. **Producto estrella** destacado: foto o video, precio por transferencia grande, precio de lista,
   referencia de mercado con % de ahorro, contador de unidades de promo y cuenta regresiva.
3. **La ficha de cada producto en promo** lo dice: badge, referencia de mercado, fecha de fin y,
   para la estrella, las unidades que quedan. Es donde aterrizan los anuncios.
4. **Badge en las cards** de catálogo, carruseles y favoritos para los productos en promo.
5. La promo **se prende y se apaga sola** por fecha: antes del inicio y después del fin no se ve nada
   (ni sección, ni badges, ni textos en la ficha).

## Non-goals (v1)

- Precio de promo propio de la tienda, límite de unidades aplicado en el checkout, cupones, packs.
  El precio sigue en Alegra; volverlo al normal cuando se agotan las unidades es manual.
- Video subido a nuestro R2 (mp4). Se usa YouTube/Vimeo (un Short no listado sirve).
- Más de una promo a la vez o un histórico de promos.
- Cuotas sin interés (no hay cobro con tarjeta activo).
- Página `/promociones` propia (el "Ver todas" puede llevar a una búsqueda o al catálogo).

## Anti-goals (lo que haría que fracase aunque funcione)

- Mostrar una promo vencida, o una fecha de fin que no se cumple.
- Mostrar un precio "antes" que nunca se cobró. La referencia de mercado no se presenta como precio
  anterior nuestro.
- Que la sección empuje a comprar algo sin stock, o siga diciendo "quedan 5" cuando ya se vendieron.
- Que la home cargue más lenta (el video no puede frenar el LCP).
- Que lanzar o terminar la promo requiera un deploy.

## Diseño

### 1. El dato: `PromocionesContent`

Nueva clave `promociones` en `SECCIONES_HOME` y `ORDEN_HOME`, con orden por defecto **justo después
del hero** **[decisión de Claude]**. Forma propuesta (el builder puede ajustar nombres):

```ts
type ItemPromo = {
  sku: string;
  /** Precio con IVA visto en otras tiendas. Ausente = sin línea de referencia ni % de ahorro. */
  precioReferencia?: number;
};

type EstrellaPromo = ItemPromo & {
  /** Link de YouTube/Vimeo (validado con `videoEmbebible`). Ausente = foto del producto. */
  video?: string;
  /** Unidades a precio de apertura. Ausente = sin contador. */
  unidadesPromo?: number;
  /** Stock del producto EN `sucursal` al guardar `unidadesPromo` (lo completa el editor). */
  stockBase?: number;
  /** Sucursal cuyo stock cuenta las unidades (slug, p. ej. "mdp"). Ausente = la predeterminada. */
  sucursal?: string;
  /** Textos propios de la tarjeta estrella; vacíos = nombre del producto. */
  titulo?: string;
  bajada?: string;
};

type PromocionesContent = TextosSeccion & {
  eyebrow?: string;          // "Lanzamiento online"
  inicio?: string;           // ISO con zona; ausente = ya empezó
  fin: string;               // ISO con zona; obligatorio si hay productos
  estrella?: EstrellaPromo;
  items: ItemPromo[];        // 0..6
  etiquetaBadge: string;     // "Precio de apertura"
  etiquetaReferencia: string; // "En otras tiendas desde"
  legales?: string;          // admite {inicio} {fin} {unidades}
  linkTodos?: string;
};
```

- **Defaults Central Led**: textos de ejemplo, sin productos ni fechas (la sección no se dibuja
  hasta que el admin carga una estrella o un ítem y un fin). Tiendas genéricas: `visibilidad:
  "nunca"`, como `tiendaOficial`.
- **Validación** (`erroresSeccion`): SKUs como texto no vacío y sin repetir entre estrella e items;
  como mucho 6 items; `precioReferencia` entero positivo; `video` aceptado por `videoEmbebible`;
  `unidadesPromo` entero ≥ 1; `fin` posterior a `inicio`; si hay estrella o items, `fin` es
  obligatorio; `sucursal` (ver punto 3) es un slug de sucursal del tenant.
- Las fechas se editan y se muestran en hora de Argentina (`America/Argentina/Buenos_Aires`).

### 2. ¿La promo está vigente?

`vigente = (!inicio || ahora >= inicio) && ahora < fin`. Se evalúa en cada request o en el cliente,
**nunca dentro de una función `'use cache'`** (el contenido de la home vive un día en caché). Fuera
de vigencia no se dibuja la sección ni se aplican badges ni textos de ficha. En "Modo edición" el
admin sí ve la sección con un aviso ("Programada: empieza el…" / "Terminó el…").

### 3. Unidades de promo de la estrella

Contador sin estado nuevo en la base **[decisión de Claude]**: al guardar `unidadesPromo`, el
editor guarda también el stock actual del producto **en la sucursal de la promo** (`sucursal`,
leído de `catalog_stock_sucursal` como el resto del stock por sucursal, no el agregado de
`dispCatalogo`, que toma el máximo entre locales) en `stockBase`. La misma lectura da
`stockActual`. Se muestra:

```
vendidas  = max(0, stockBase - stockActual)
quedan    = clamp(unidadesPromo - vendidas, 0, unidadesPromo)
```

- `quedan > 0`: "Quedan **3 de 5** a precio de apertura" con una barra de progreso. Con
  `quedan ≤ 2`, el texto pasa a "¡Últimas unidades!" con el acento de oferta. Los números son
  siempre los reales: Emanuel propuso inflar el total para generar FOMO y se descartó (publicidad
  engañosa sobre cantidad, DNU 274/2019; además arriesga los anuncios en Meta). La urgencia sale de
  la escasez real, la cuenta regresiva y, si se agotan, una "segunda tanda" nueva (otra carga de
  `unidadesPromo` con su `stockBase`).
- `quedan = 0`: la tarjeta estrella dice "Agotadas las unidades a precio de apertura" y el botón
  lleva a la ficha (no agrega al carrito); en "Modo edición" se ve el aviso "Quite el ajuste de
  precio del producto en Precios online del CRM". Si entra stock nuevo, `quedan` no supera `unidadesPromo`.
- Todo texto nuevo de la UI va en español formal de usted (regla del repo).
- Sin stock total: la estrella se muestra agotada (nunca un "Agregar" sobre algo sin stock).

Limitaciones conocidas y aceptadas: el contador baja cuando baja el stock de esa sucursal (venta
del local y pedidos reservados incluidos; un pedido cancelado lo vuelve a subir), no por ventas
online únicamente. El precio de promo es uno solo para toda la tienda online (el CRM no tiene
precio por sucursal); hoy el Noak, los Candle y el Fungus solo tienen stock en MdP. La sección, los
badges y la ficha se ven igual para todos los visitantes (sin partir por zona: no rompe la clave de
caché del catálogo).

### 4. Precios en la sección y en la ficha

- **Precio principal: el de transferencia** (`precioMedio`, con IVA), grande, con la leyenda "por
  transferencia". **En la sección no se muestra el precio de lista** **[decisión de Claude]**: hoy
  online solo se paga por transferencia, y un "precio de lista" más alto al lado del de promo se lee
  como "nuestro precio anterior" (anti-goal). Si el producto no tiene `precioMedio`, el precio de
  lista pasa a ser el principal. Las cards estándar del catálogo siguen como hoy.
- **Referencia de mercado**: si `precioReferencia > precio principal`, una línea "En otras tiendas
  desde $150.000" y un chip "−27 %" (ahorro contra la referencia, redondeado hacia abajo). **No** se
  usa `oldPrice` tachado para la referencia **[decisión de Claude]**: tachado se lee como "nuestro
  precio anterior" y eso no es cierto (ver anti-goals).
- **Legales** debajo de la sección y en la ficha de los productos en promo, en letra chica:
  texto del admin con `{inicio}`, `{fin}` y `{unidades}` reemplazados. Default sugerido:
  "Promoción válida del {inicio} al {fin} o hasta agotar {unidades} unidades del producto estrella.
  Precios finales con IVA para pago por transferencia. Stock sujeto a disponibilidad."

### 5. La sección en la home

- **Desktop**: tarjeta estrella grande a la izquierda (media arriba o a la izquierda, textos,
  precios, contador, cuenta regresiva, botón "Agregar" y "Ver detalle"); a la derecha o debajo, la
  grilla de items con la card estándar del catálogo + badge + línea de referencia.
- **Mobile**: estrella a ancho completo primero; items en carrusel o grilla de 2.
- **Cuenta regresiva** (componente cliente): "Termina en 3 d 04 h 12 m" (con segundos solo en las
  últimas 24 h). Al llegar a cero, la sección se oculta sin recargar.
- **Video**: fachada con la foto del producto y botón de play; el iframe recién se carga al tocar
  (o al entrar en viewport, a criterio del builder) para no tocar el LCP. Mudo y en loop si el
  proveedor lo permite.
- Productos que no existan, estén ocultos o sin stock: los items sin stock no se muestran; si la
  estrella no está disponible se ve agotada (punto 3). Sin estrella ni items visibles, no hay sección.
- Tono visual: el de la home actual, con un acento de "oferta" propio (el builder elige, dentro del
  DS). Usar `frontend-design`.

### 6. Badge en cards y ficha

- **Cards** (catálogo, carruseles de la home, relacionados, favoritos): los productos en promo
  vigente llevan `badge` = `etiquetaBadge`. Sin cambios de precio en la card (el precio ya es el de
  Alegra). La línea de referencia en la card es opcional para el builder.
- **Ficha**: badge arriba del precio, línea de referencia + chip de ahorro, "Termina en…" con la
  misma cuenta regresiva, contador de unidades si es la estrella, y legales. Es lo que ve quien
  viene de un anuncio de Instagram.
- Cómo se sabe que un producto está en promo: `getContenidoHome()` (ya cacheado, ya se lee en el
  layout) → SKUs de `promociones`, cruzados **solo por SKU exacto** (normalizado como en
  `elegirDestacados`, sin comparar nombres) **[decisión de Claude]**. Con variantes agrupadas, el
  badge va en la card solo si el SKU en promo es la variante que la card representa; los productos
  de esta promo son simples. La vigencia se
  calcula fuera de caché (punto 2). Las listas de productos cacheadas no cambian: el badge se aplica
  después de leerlas.

### 7. Edición

Editor propio en el registro de `EDITORES` (`TITULOS_SECCION`: "Promociones"), reutilizando
`CampoAcento`, `SelectorSkusDestacados` y los campos de texto existentes:

- Textos (eyebrow, título, bajada), inicio y fin (fecha y hora), etiquetas, legales, link.
- Estrella: selector de un producto, video, precio de referencia, unidades de promo (al guardar se
  completa `stockBase` con el stock de ese momento; si cambia la estrella o las unidades, se vuelve
  a tomar), título y bajada propios.
- Items: selector de hasta 6 productos, cada uno con su precio de referencia.
- El editor muestra el precio actual de cada producto (transferencia, con IVA) y, si hay referencia,
  el % de ahorro resultante, para que el admin vea si ya cargó el ajuste en el CRM.
- Sucursal del contador: selector con las sucursales del tenant (default la predeterminada).

### 8. Productos por SKU sin relleno

Nueva lectura cacheada en `catalogo-publico.ts` (como `destacadosCacheados`) sobre
`getProductosPorSkus`, que devuelve **solo** los SKUs pedidos, en el orden pedido, con precios por
medio, stock y fotos. Mismo `TAG_CATALOGO`, para que un cambio de precio en Alegra se vea igual que
hoy (aviso del CRM o 15 minutos). Si es un archivo nuevo con `'use cache'`, sumarlo a `CON_CACHE`.

## Testing

- Validación y defaults (`home-defaults.test.ts`, `defaults-marca.test.ts`, `home-editor.test.ts`),
  listas de orden y conteos de `SeccionEditable` que enumeran secciones (ver PR #668).
- Puros con tests propios: vigencia (`inicio`/`fin`, zona horaria, borde exacto), contador de
  unidades (venta, reposición, sin stock), % de ahorro y redondeo, reemplazo de `{inicio}` `{fin}`
  `{unidades}`, cruce de SKUs para el badge.
- Render (`renderToStaticMarkup`): sección vigente / programada / vencida; estrella agotada sin botón
  de agregar; ficha con y sin promo.
- `npm run lint`, `npx tsc --noEmit`, `npm test` desde `apps/clientes`. Verificación en navegador
  con el dev server antes del PR.

## Lo que queda al builder

- Nombres finales de tipos, archivos y componentes; layout fino y estética dentro del DS.
- Si la cuenta regresiva y la vigencia se resuelven en el servidor con `connection()` o en el
  cliente (con la regla del punto 2).
- Si la línea de referencia aparece también en las cards del catálogo.
- Cuándo cargar el iframe del video (al tocar o al entrar en viewport).
- Formato exacto de fechas en legales ("del 3/11 al 13/11").
