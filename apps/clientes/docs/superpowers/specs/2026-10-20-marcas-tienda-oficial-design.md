# Páginas de marca y Tienda oficial Led Premium — Design

_2026-10-20 · Brainstorming aprobado por Emanuel_

## Contexto

Led Premium es un fabricante de iluminación LED profesional (mayormente decorativa) de Mar del
Plata. Central Led Mar del Plata pasa a ser **su vendedor oficial online**: la web de Led Premium
queda como landing, catálogo y canal de contacto para obras, y su tienda online va a redirigir a
la de Central Led. Queremos darle a Led Premium un lugar propio dentro del Shop, al estilo de las
"tiendas oficiales" de MercadoLibre, y relevancia en la home.

De paso se arma el sistema para otras marcas principales (Macroled y Jadever por ahora) con una
página más simple.

Lo que la página de Led Premium tiene que transmitir, en palabras de Emanuel:

1. Que son **fabricantes profesionales**.
2. Que es una **línea premium**.
3. Que **Central Led es el vendedor oficial online** de la marca.

Lo que ya hay en el Shop y condiciona el diseño:

- **La marca de un producto es solo texto.** `marcaSql` (`src/lib/catalog.ts`) toma el custom
  field "marca" de Alegra y, si está vacío, cae al nombre de la categoría de Alegra. Si el overlay
  del CRM tiene `mostrar_marca = false`, devuelve `null`. El filtro `?marca=` compara el valor crudo
  exacto, sin normalizar (`inArray(marcaSql, filtros.marcas)`). No hay tabla, logo, slug ni
  descripción de marca en ningún lado.
- **El catálogo muestra por defecto solo productos con stock** (`SOLO_STOCK_DEFAULT = true`),
  visibles (`soloVisibles`) y disponibles en la zona del visitante (`disp`).
- **`/catalogo?marca=…` es `noindex`** (`indexable()` en `src/lib/catalogo-vista.ts`). Para que una
  página de marca se indexe necesita ruta propia.
- **Los productos de Led Premium ya están en el Alegra de Central Led**, con fotos (lo confirmó
  Emanuel). El valor exacto del campo marca no está verificado.
- **La home se edita en el lugar** (`SeccionEditable`, `home-acciones.ts`), con contenido en
  `shop.home_content` acotado por tenant. Las páginas institucionales ya reusan esa tabla con filas
  `pagina:<slug>` (`src/lib/institucional/paginas.ts`), y `/editar-paginas` es una ruta solo para
  admin.
- **El DS (`@myd-org/ui` 0.56) no tiene submenús en el header**: `SiteNavItem` es
  `{label, href, badge?, badgeVisibleOn?}`. **No hay menú hamburguesa**: la fila de nav del header
  completo tiene scroll horizontal (`overflow-x-auto`) en todos los tamaños. La barra compacta fija
  repite el nav solo desde `lg` (`hidden … lg:flex`). `Marquee` es decorativo de punta a punta:
  `aria-hidden`, `pointer-events-none` y con cada ítem repetido muchas veces.
- **La barra de categorías del header se ve solo en la home** (`HeaderUI.tsx`, hasta
  `MAX_CATEGORIAS_NAV = 8`).
- **"Marca" ya es otra cosa en el código**: la identidad de la tienda (`Marca`, `getMarca`,
  `useMarca`, `TAG_MARCA`, `marca-base.ts`), y además `pagos/marcas.ts` (marcas de tarjeta). El
  concepto nuevo necesita otro nombre. Acá se usa **`PaginaMarca`**.
- **El Shop es multi-tienda** (`marca.base = "central" | "generica"`, Avantec). Nada de esto puede
  quedar fijo para Central en el código.
- **La web de Led Premium estaba caída el 2026-10-20** (Vercel `402 DEPLOYMENT_DISABLED`). Sus fotos y su
  video no se pueden enlazar desde ahí.

Decisiones tomadas en el brainstorming:

| Pregunta | Decisión |
|---|---|
| Qué se arma | **Sistema de páginas de marca de dos niveles**: "Tienda oficial" (completa) y "Página de marca" (simple) |
| Quién es Tienda oficial | **Solo Led Premium** |
| Quién tiene Página de marca | **Macroled y Jadever**; después Emanuel puede sumar otras |
| El resto de las marcas | **Sin página.** Siguen en el filtro de marca del catálogo, como hoy |
| Dónde entra en el header | **Opción B**: ítem "Marcas ▾" con desplegable, Led Premium destacado arriba |
| Relevancia en la home | **Bloque oscuro "Tienda oficial"** con productos y botón de entrada |
| Estructura de la Tienda oficial | La del boceto: hero → confianza → líneas → más elegidos → componentes → obras → cotización de obra → todos los productos |
| Cotización de obras grandes | **Le llega a Central Led**, que después la deriva a Led Premium |
| Estética | Solo la Tienda oficial usa la estética de Led Premium (negro y dorado). Las demás, la de Central |

## Goals

1. `/marcas/led-premium` presenta a Led Premium como fabricante profesional y línea premium, deja
   claro que Central Led es el vendedor oficial online, y permite comprar sus productos ahí mismo.
2. `/marcas/macroled` y `/marcas/jadever` muestran logo, una línea de quiénes son y todos sus
   productos.
3. Las páginas de marca y `/marcas` se indexan en Google y figuran en el sitemap.
4. Desde la home se llega a la Tienda oficial por dos caminos: el bloque destacado y "Marcas ▾".
5. Un admin crea, edita, ordena, publica y oculta páginas de marca sin tocar código, con el mismo
   tipo de edición en el lugar que usa la home.
6. Un pedido de cotización de obra Led Premium le llega a Central Led por WhatsApp, con el contexto
   ya escrito.

## Non-goals (v1)

- Precio mayorista o descuento por cantidad para Led Premium (hoy su web da −10% desde 20 unidades).
- El video "La fábrica" (estaba alojado en la web de ellos).
- Páginas para marcas que no sean las tres elegidas (el sistema lo permite, pero no se cargan).
- Cambios en la web de Led Premium: la redirección de su tienda a `/marcas/led-premium` la hace quien
  maneje esa web.
- Un formulario de cotización: v1 usa WhatsApp.
- Links en la cinta de marcas de la home (ver §9).
- Enlazar la marca desde la ficha de producto (`/producto/[id]`) a su página. Queda como mejora
  posible.
- Tocar los datos de Alegra o del CRM.

## Anti-goals (lo que haría que fracase aunque funcione)

- **Que la página de Led Premium parezca "otro sitio"** y se pierda que se está comprando en
  Central Led: header, carrito, footer y checkout siguen siendo los de Central Led.
- **Que la marca escrita distinto en Alegra** ("Led Premium" / "LED PREMIUM") **deje productos
  afuera.**
- **Que las páginas no aparezcan en Google.**

## Diseño

### 1. El dato: `PaginaMarca`

Una página de marca se guarda como fila `pagina-marca:<slug>` en `shop.home_content`, igual que las
institucionales (`pagina:<slug>`): queda acotada por tenant y no hace falta migración. El
listado (para `/marcas`, el desplegable y el sitemap) se arma leyendo las filas con ese prefijo.
_Llamada mía._

```ts
type NivelMarca = "oficial" | "marca";

type PaginaMarca = {
  slug: string;                 // "led-premium": la URL. Único por tenant.
  nombre: string;               // "Led Premium": lo que se muestra.
  nivel: NivelMarca;
  publicada: boolean;           // false = solo la ve un admin.
  orden: number;                // Orden en /marcas y en el desplegable. "oficial" va siempre primero.
  marcasCatalogo: string[];     // Valores CRUDOS de marcaSql que son esta marca, ej. ["LED PREMIUM", "Led Premium"].
  logo?: string;                // URL de imagen (mismo flujo R2 que la home).
  bajada: string;               // Una línea de quiénes son.
  seo?: { titulo?: string; descripcion?: string; imagenOg?: string };
  secciones: SeccionesMarca;    // Contenido por bloque + visibilidad, como la home.
};
```

**El vínculo marca ↔ productos es `marcasCatalogo`.** Es la respuesta directa al anti-goal de la
marca mal escrita:

- El editor **no deja tipear** los valores. Ofrece la lista real de marcas del catálogo (la faceta
  `marcas`, con su cantidad de productos) para elegir uno o varios. Esa lista se consulta **sin
  filtro de stock ni de zona** (`soloStock: false`), así una marca sin stock momentáneo no
  desaparece del selector.
- Los productos de la página se consultan por `marcasCatalogo` comparando contra el valor de marca
  **sin el corte de `mostrar_marca`**: ese flag del overlay decide si se *muestra* la marca en la
  tarjeta, no si el producto es de la marca. Con `marcaSql` tal cual, un producto con
  `mostrar_marca = false` quedaría afuera de su página, que es el anti-goal. Hace falta una variante
  del filtro (por ejemplo `coalesce(nullif(brand,''), categoría)` sin el `case`). _Llamada mía._ No
  hace falta normalizar mayúsculas: lo resuelve tener varios alias.
- Si un valor elegido deja de existir en el catálogo (lo renombraron en Alegra), el editor lo marca
  como "sin productos" para que el admin lo corrija.
- Cuidado: como `marcaSql` cae al nombre de la categoría de Alegra cuando la marca está vacía, en
  la lista pueden aparecer nombres de categoría. Es esperable, no se filtra.

### 2. Rutas

| Ruta | Qué es | Indexable |
|---|---|---|
| `/marcas` | Grilla de logos de las páginas publicadas. La Tienda oficial va primero y destacada | Sí |
| `/marcas/[slug]` | Página de marca, nivel "oficial" o "marca" | Sí (sin query string) |
| `/marcas/[slug]?…` | Mismo contenido con filtro de línea o página de resultados | `noindex, follow`, canonical a `/marcas/[slug]` |
| `/editar-marcas` | Admin: crear, ordenar, publicar y borrar páginas | No (`notFound()` si no es admin, como `/editar-paginas`) |

- Un slug inexistente o no publicado (para un no-admin) da `notFound()`.
- `generateMetadata` arma título, descripción y OG desde `seo` o, si falta, desde
  `nombre`/`bajada`/`logo`. Para la Tienda oficial el título por defecto es "Led Premium — Tienda
  oficial | Central Led", con el nombre de la tienda sacado de `getMarca()`.
- El sitemap suma `/marcas` y cada `/marcas/[slug]` publicada (`entradasSitemap` en `src/lib/seo.ts`).
  Si no hay ninguna publicada, `/marcas` tampoco va al sitemap.
- `/catalogo?marca=…` sigue siendo `noindex`.
- Migas: Inicio › Marcas › {nombre}.
- `src/proxy.ts` **no se toca**. Las páginas ya son públicas, y `RUTAS_PUBLICAS` es solo para rutas
  servidor a servidor que se saltean el cartel "Próximamente". Agregar `/marcas` ahí sería un
  error.

### 3. Página nivel "oficial" (Led Premium)

Mismo marco de Central Led (header, footer, carrito). El contenido va con la estética de la marca
(ver §6). Los bloques, en orden, se pueden editar y ocultar uno por uno (`siempre/desktop/mobile/nunca`,
como en la home):

1. **Hero**: logo, sello "Tienda oficial · Vendedor oficial online", nombre, bajada, imagen de fondo
   (foto nocturna de obra con velo oscuro) y botón "Ver los N productos" (ancla al bloque 8, con N
   real).
2. **Confianza**: hasta 4 ítems `{valor, texto}`. Contenido inicial, de lo que publica la marca:
   "+60 años de experiencia", "100% fabricación argentina", "2 años de garantía de fábrica", "+500
   obras en 24 provincias". **Emanuel tiene que confirmar los números con Led Premium antes de
   publicar.**
3. **Líneas**: tiles editables `{titulo, imagen, href}` con el patrón de `TileContent`. Las líneas
   de Led Premium (Exterior, Interior, Piscinas, Proyectores, Control y accesorios) **no son**
   categorías del Shop, así que no se derivan. El `href` típico lleva al bloque 8 filtrado
   (`/marcas/led-premium?linea=…#productos`, ver §5).
4. **Los más elegidos**: carrusel de productos elegidos por SKU. Reusa el selector de `destacados`
   (`buscarProductosHome` / `resolverProductosHome`), acotado a productos de `marcasCatalogo`.
5. **Lo que va adentro**: título, una línea y chips de texto (LED CREE, Driver Philips Xitanium, CRI
   90, IP67/IP68, Acero AISI 304, Aluminio CNC anodizado).
6. **Obras**: galería de 3 a 6 fotos `{imagen, alt, epigrafe?}`.
7. **Cotización de obra**: texto ("¿Una obra grande, un barrio o un proyecto de arquitectura?"),
   bajada y botón que abre WhatsApp de la tienda con un mensaje ya escrito (ver §7).
8. **Todos los productos** (`id="productos"`): ver §5.

### 4. Página nivel "marca" (Macroled, Jadever)

Misma plantilla con menos bloques: un **encabezado claro** con logo, nombre y bajada sobre los
colores de Central (sin sello "oficial") y, debajo, **Todos los productos** (§5). Opcionalmente
también **Líneas**, apagado por defecto. Los bloques Confianza, Componentes, Obras y Cotización no
existen en este nivel. _Llamada mía._

### 5. "Todos los productos"

Para v1 no se reusa `CatalogoClient` (que trae búsqueda, facetas completas, IA y estado en URL),
porque es mucho para 31 productos. _Llamada mía._

- Los datos salen de `paginaCatalogoPublica` con el filtro de marca de §1, que es cacheable porque
  no lleva texto libre. Paginación de 24 (`PRODUCTOS_POR_PAGINA`).
- **Las tarjetas son las del catálogo** (la grilla de `CatalogoProductos` o
  `TarjetaProductoCarrusel`), **no** un `ProductCard` pelado. Un `ProductCard` pelado mostraría el
  precio público a clientes con lista propia (`TarjetasPrecioCuenta`) y perdería los precios por
  medio de pago, las cuotas y favoritos.
- **Filtro por línea** con chips arriba de la grilla, que se refleja en `?linea=<slug>` y es lo que
  usan los tiles del bloque 3. Cada línea se define en el editor del bloque con **una o varias
  categorías del Shop, una lista de SKUs, o las dos cosas** (unión). Hoy no sabemos cómo están
  repartidos los productos de Led Premium entre las categorías del Shop. Si caen todos en
  "Iluminación", las líneas se arman por SKU. _Llamada mía._
- Orden por defecto: el del catálogo. Selector de orden de precio opcional.
- Link "Ver con todos los filtros →" a `/catalogo?marca=…` (con todos los valores de
  `marcasCatalogo`) para quien quiera filtrar por precio o stock.
- El título del bloque muestra el total real ("31 productos").

### 6. Estética de la Tienda oficial

- Los tokens de color se pisan **solo dentro del contenido de la página**, con un atributo en el
  contenedor (por ejemplo `data-tema="oficial"`) en `globals.css`: fondo `#0c0c0c` / `#141418`,
  texto claro y acento por defecto dorado `#c0a15a`. Header y footer no cambian.
- Ese acento queda como campo opcional de la `PaginaMarca` para tiendas genéricas que tengan otra
  marca oficial. Se valida contraste como en `contraste-tokens.test.ts` y, si no pasa, se rechaza al
  guardar. _Llamada mía._
- Tipografía: Sora, que ya está cargada y coincide con la de Led Premium. Títulos grandes en peso
  light y etiquetas en versalitas espaciadas.
- El bloque 8 puede volver a fondo claro para que las tarjetas de producto sean las de siempre.
  Queda a criterio del builder.

### 7. WhatsApp de cotización

- El número es el de la tienda (`footer.whatsapp`, solo dígitos) y el link se arma con
  `enlaceWhatsapp(numero, texto)` (`src/lib/contacto-pedido.ts`). Si no hay número válido, el bloque
  no se muestra y el editor avisa. _Llamada mía._
- El texto precargado se edita en el bloque. Por defecto: "Hola, quiero cotizar una obra con
  productos Led Premium." Es la voz del cliente, así que no le aplica la regla de "usted". Todo el
  resto del texto de UI nuevo **sí** va en usted (`CLAUDE.md`).

### 8. Header: "Marcas ▾"

**Va por el DS.** `@myd-org/ui` suma a `SiteNavItem` un campo opcional
`menu?: { label: string; href: string; destacado?: boolean; descripcion?: string }[]`. Un ítem con
`menu` se dibuja como disparador de un desplegable de Radix (`react-dropdown-menu`, con portal para
que la fila con `overflow-x-auto` no lo recorte), tanto en la barra normal como en la compacta fija
(que solo existe desde `lg`). Los ítems navegan con el `renderLink` del header. _Llamada mía:_ es más
limpio que poner un disparador aparte en la app.

**`destacado` se dibuja con tokens, no con dorado fijo**: fondo y texto invertidos
(`foreground`/`background`) y el acento del tema. El DS es compartido y no puede saber nada de Led
Premium. En la tienda de Central se verá oscuro con el acento de Central. Si más adelante se quiere
el dorado exacto, el camino es que el ítem acepte variables CSS de color desde la app, no un
color en el DS. _Llamada mía._

- La app agrega "Marcas" como **último ítem** de la barra de la home **solo si hay al menos una
  página publicada**. Si no hay ninguna, la barra queda como hoy (8 categorías). Si hay, quedan 7
  categorías y "Marcas".
- **`EditorNavBadge` también se ajusta**: usa `MAX_CATEGORIAS_NAV` (`src/lib/nav-badge.ts`) para
  ofrecer las categorías visibles. Si "Marcas" ocupa el lugar 8, tiene que ofrecer 7, porque si no
  un badge puesto en la octava categoría no se ve nunca.
- Contenido del desplegable:
  1. La(s) página(s) "oficial", destacadas (ver arriba) con su bajada.
  2. Las de nivel "marca", por `orden`.
  3. "Ver todas las marcas →" a `/marcas`.
- **Mobile:** no hay menú hamburguesa. "Marcas" es un ítem más de la fila con scroll del header
  completo y al tocarlo abre el mismo desplegable. Si en pantalla chica el desplegable no anda bien, el builder puede
  hacer que en mobile "Marcas" navegue directo a `/marcas`.
- Igual que las categorías, se ve **solo en la home**. Desde el resto del sitio se llega por el
  bloque de la home y por `/marcas`.

### 9. Home

**Bloque nuevo `tiendaOficial`** en `SECCIONES_HOME`, ubicado **después de `destacados`**.

Contenido:
```ts
{
  slug: string;        // Qué PaginaMarca destaca (nivel "oficial").
  titulo: string;      // "Iluminación profesional, fabricada en Mar del Plata."
  cta: string;         // "Entrar a la tienda oficial"
  skus: string[];      // 3 productos.
}
```
Toma logo y nombre de la `PaginaMarca`. Si la página no existe o no está publicada, el bloque no se
dibuja.

Puntos a tocar, para que no se escape ninguno:
- `HomeContent`.
- `SECCIONES_HOME`.
- `DEFAULTS_HOME`: visible, `slug: "led-premium"`, `skus: []`.
- `defaultsHomeGenerica`: `"nunca"`.
- El `case` en `erroresSeccion`, que rechaza claves desconocidas.
- `combinarContenidoHome`.
- `Editor*.tsx` nuevo con el selector de SKUs de destacados.
- El slot en `HomeClient`.

**Cinta de marcas (`marquee`): queda como está en v1.** Agregarle links no es sumar un `href`: el
`Marquee` es `aria-hidden`, `pointer-events-none` y repite cada ítem decenas de veces, así que
habría que rehacer su accesibilidad e interacción. La entrada a las marcas ya la dan "Marcas ▾",
`/marcas` y el bloque de la home. Agregar el logo de Led Premium a la cinta es contenido y lo puede
hacer el admin hoy. _Llamada mía._ Pasa a non-goals.

### 10. Edición

- Admin = `esAdmin()`. El modo edición es el mismo de la home (`ModoEdicionProvider`,
  `EdicionSiAdmin`, `BarraEdicion`). `SeccionEditable` hoy está atado a `SeccionHome`, así que hay
  que generalizarlo o hacer un hermano para los bloques de marca. Queda al builder, con una
  condición: para el admin tiene que sentirse igual que editar la home.
- Las imágenes (logo, hero, tiles, obras) usan el flujo R2 existente (`CampoImagen` →
  `firmarSubidaImagenHome`, 5 MB, una variante de 1600 px). La validación es `esImagen`.
- Las acciones de servidor siguen el patrón de `home-acciones.ts` / `paginas-acciones.ts`:
  `esAdmin()` → validar → guardar → `updateTag`, y devuelven `{ok, errores}` sin tirar errores. El
  tag puede ser `TAG_HOME`, como las institucionales, o uno propio. La consulta de productos ya
  cuelga de `TAG_CATALOGO`.
- `/editar-marcas` lista las páginas y permite crear una (nombre, slug, nivel, `marcasCatalogo` con
  el selector de §1), reordenar, publicar u ocultar, y borrar. El contenido de cada página se edita
  en la página misma.

### 11. Tiendas genéricas

Todo funciona igual en una tienda `generica`, pero sin nada precargado: no hay páginas de marca, la
barra no muestra "Marcas" y `tiendaOficial` arranca en `"nunca"`. Los contenidos por defecto de Led
Premium (textos de confianza, chips de componentes) se ofrecen solo como texto inicial al crear una
página "oficial" en una tienda `central`, o directamente como placeholder vacío, a criterio del
builder. Nunca quedan como dato de código que aparezca en otra tienda.

## Dependencias y orden sugerido

1. **DS** (`MyD-Org/ui`): `SiteNavItem.menu`, con release y bump en
   `apps/clientes`. Es un repo aparte; ver la memoria sobre el registro `@myd-org` para instalar.
   Se puede hacer en paralelo con el paso 2.
2. **Shop**:
   1. Tipo `PaginaMarca` y lectura/guardado.
   2. `/editar-marcas`.
   3. `/marcas/[slug]` con los bloques.
   4. `/marcas`.
   5. SEO y sitemap.
   6. Bloque `tiendaOficial` en la home.
   7. "Marcas ▾" (necesita el paso 1).
3. **Contenido** (Emanuel, antes de publicar):
   - Valor real de la marca en Alegra para Led Premium, Macroled y Jadever.
   - Logo de Led Premium en buena resolución, fotos de obras y textos de confianza confirmados por
     la marca. Como la web de ellos está caída, pedírselos directo.
   - Logos de Macroled y Jadever: ya están en `public/images/marcas/`.

## Testing

Vitest, al lado del código:
- Validación de `PaginaMarca`, que rechaza slug duplicado, `marcasCatalogo` vacío y acento sin
  contraste.
- Guardado acotado por tenant, como `home-guardar.tenant.test.ts`.
- `/marcas/[slug]`: `notFound` para no publicada o inexistente, metadata, canonical y `noindex` con
  query.
- Sitemap.
- El ítem "Marcas" aparece solo con páginas publicadas.
- `erroresSeccion("tiendaOficial", …)`.
- Defaults de la tienda genérica.

- Un producto con `mostrar_marca = false` igual aparece en su página de marca.
- El selector de marcas del editor lista marcas sin stock.
- `EditorNavBadge` ofrece 7 categorías cuando se muestra "Marcas".

En el DS, tests de `SiteHeader` con `menu` (accesible por teclado, portal fuera de la fila con
scroll) y de `destacado`.

## Lo que queda al builder

- Nombres finales de archivos y componentes, siempre que no se pisen con `Marca` / `getMarca`.
- Si `SeccionEditable` se generaliza o se duplica.
- Tag de caché propio o `TAG_HOME`.
- Si el bloque 8 de la Tienda oficial va sobre fondo claro u oscuro.
- Fallback de mobile para "Marcas" (desplegable o link a `/marcas`).
- Si conviene JSON-LD `Brand`/`Organization` en las páginas de marca.
