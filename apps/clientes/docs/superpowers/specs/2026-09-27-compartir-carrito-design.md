# Compartir carrito por link — Design

_2026-09-27 · Brainstorming aprobado por Emanuel_

## Contexto

Un cliente del shop quiere pasarle su carrito a otra persona (un compañero que
aprueba la compra, alguien que paga, etc.). Se descartó compartir "por API"
(buscar al otro usuario, permisos, notificaciones): el canal lo pone el usuario
—casi siempre WhatsApp— y alcanza con un link.

El carrito ya tiene todo lo necesario para esto:

- El servidor sólo acepta `{ id, qty }` del navegador. Precio, IVA y stock los
  resuelve `/api/carrito/cotizar` (`src/lib/cotizacion.ts`). Un link con
  `id:qty` no transporta nada que haya que validar como confiable.
- `agregarVarios` (`src/lib/carrito-cliente.ts`) ya hace altas en lote con los
  topes (`QTY_MAX`, `MAX_LINEAS`); lo usa "Repetir pedido".
- El motor (`src/lib/carrito-sync.ts`) sincroniza cualquier `mutar()` tanto
  para invitado (localStorage) como con sesión de Clerk (`shop.carts`).

Decisiones tomadas en brainstorming:

| Pregunta | Decisión |
|---|---|
| Quién comparte | **Sólo usuarios del shop** (con o sin sesión). El vendedor/presupuesto es v2 |
| Qué es el link | **Una foto** del carrito al momento de compartir, no acceso al carrito del otro |
| Dónde viajan los datos | **En la URL** (`id:qty`), sin tabla nueva |
| Abrir el link | **Página intermedia** de preview; abrir no modifica nada |
| Conflicto con carrito existente | **Reemplazar / Sumar / Cancelar** |
| Semántica de "Sumar" | **Suma cantidades** (2 + 2 = 4), no `mergeMax` |
| Dónde está el botón | **Sólo en `/carrito`** (no en el mini carrito del header) |

## Goals

1. Desde `/carrito`, compartir el carrito en un toque (share sheet nativo en
   mobile, copiar link en desktop).
2. Quien abre el link ve los productos con precio actual y los carga en ≤ 2
   toques.
3. Nunca pisar el carrito del receptor sin que lo elija explícitamente.

## Non-goals

- Compartir desde el CRM / un vendedor / a partir de un presupuesto de Alegra
  (v2; ahí el precio negociado es el problema central).
- Precios congelados: el receptor paga el precio publicado al momento de cargar.
- Links cortos, vencimiento, o saber quién compartió / cuántos abrieron.
- Múltiples carritos por usuario.
- Link "vivo" que refleje cambios posteriores del carrito original.

## Diseño

### 1. Formato del link

```
/carrito/compartido?i=<id>:<qty>,<id>:<qty>,...
```

- Sólo ids de Alegra y cantidades enteras. Nada de precio, nombre ni usuario.
- Módulo puro nuevo `src/lib/carrito-compartido.ts` (sin imports de DB ni
  Next, igual que `carrito-cliente.ts`: lo usan el navegador y el servidor):
  - `codificarCompartido(items: readonly LineaCarrito[]): string` → valor de `i`.
  - `parsearCompartido(raw: string | null | undefined): LineaCarrito[]` →
    tolerante: descarta pares mal formados, ids que no pasarían
    `validarItemsBody` (mismo largo máximo y mismo criterio) y qty no enteras
    o ≤ 0;
    pasa el resultado por `normalizarCarrito` (dedup, `QTY_MAX`, `MAX_LINEAS`).
    Un valor basura devuelve `[]`, nunca tira.
  - `hrefCompartido(items): string` → path completo con el query.
- Tamaño: con `MAX_LINEAS = 60` e ids numéricos cortos el link queda en el orden
  de 500 caracteres; WhatsApp y los navegadores lo manejan sin problema.

### 2. Compartir (emisor)

- Botón **"Compartir carrito"** en `src/components/CarritoClient.tsx`, visible
  sólo con el carrito no vacío. Abre un **menú propio** (`DropdownMenu` de
  `@myd-org/ui`), no la hoja nativa: en escritorio esa hoja ofrece AirDrop,
  Notas o Recordatorios y no WhatsApp.
  - **WhatsApp** → `https://wa.me/?text=<mensaje>` en otra pestaña, sin
    destinatario (el usuario elige el contacto).
  - **Copiar enlace** → portapapeles + toast; si falla, toast de error con el
    link visible para copiar a mano.
  - **Más opciones** → sólo donde existe `navigator.share`: abre la hoja del
    sistema a pedido. Cancelarla no avisa nada.
- El mensaje es `"Te comparto mi carrito: <url>"`. **Tutea a propósito**: es la
  voz del cliente hablándole a otra persona, no copy de la tienda (que sigue en
  usted). Vive en `carrito-compartido.ts`, fuera de la guarda de voseo.
- Las líneas marcadas `faltante` se incluyen igual: el receptor verá el aviso
  en la preview.

### 3. Página `/carrito/compartido` (receptor)

- Server component en `src/app/carrito/compartido/page.tsx`. Lee `i`, lo parsea
  con `parsearCompartido` y resuelve los productos del catálogo del tenant con
  la misma fuente que `cotizacion.ts` (vista `catalog_products_shop` + overlay
  para el nombre exhibido + foto de portada). No llama a Alegra.
- Muestra: foto, `nombreConMarca`, cantidad, precio actual por unidad y
  subtotal referencial.
- Los productos no encontrados, inactivos o sin precio van a un bloque aparte:
  "N productos de este carrito ya no están disponibles" y **no se cargan**.
- **Renderizar la página no modifica ningún carrito** (los crawlers de preview
  de WhatsApp/Telegram hacen GET al link). La carga es una acción del usuario.
- Metadata **estática**: `title` "Le compartieron un carrito", `robots: noindex`.
  No lee `searchParams`: con Cache Components una metadata que lee el request
  bloquea el render de toda la página (se detectó al verificar en el navegador),
  así que la vista previa no dice cuántos productos son. OG image: la de la tienda.
- La página está detrás del gate del sitio igual que el resto (no se agrega a
  `RUTAS_PUBLICAS`: esa lista es para servidores externos sin cookies).

### 4. Cargar al carrito

Componente cliente `CargarCompartido` con el botón principal **"Cargar al
carrito"**. Recibe del servidor las líneas disponibles como
`{ item: Omit<CartItem, "qty">, qty }[]` (con precio/nombre/foto ya
resueltos, para pintar el carrito al instante).

Decisión pura en `carrito-compartido.ts`:

```ts
type AccionCompartido = "cargar" | "preguntar" | "igual";
function accionAlCompartir(actual: readonly LineaCarrito[], compartido: readonly LineaCarrito[]): AccionCompartido
```

- `actual` vacío → `"cargar"`: reemplaza y navega a `/carrito`.
- `actual` con el mismo contenido (mismos ids y qty, sin importar el orden) →
  `"igual"`: navega a `/carrito` sin tocar nada.
- Otro caso → `"preguntar"`: diálogo con tres opciones:
  - **Reemplazar mi carrito** → `replaceItems(compartidos)` (ver abajo).
  - **Sumar a mi carrito** → `addItems(compartidos)` (usa `agregarVarios`:
    suma cantidades, respeta `QTY_MAX` y `MAX_LINEAS` y avisa si recorta).
  - **Cancelar** → cierra el diálogo, queda en la preview.
- Tras reemplazar o sumar: navegar a `/carrito`. La cotización de ahí confirma
  precio y stock como en cualquier carrito.
- El botón queda deshabilitado hasta que el carrito esté `ready` (la decisión
  necesita el carrito real, no el snapshot vacío del servidor).
- `CartContext` expone una acción nueva `replaceItems(lista)`: una sola
  mutación, así el motor sube un único guardado.

### 5. Errores y bordes

| Caso | Comportamiento |
|---|---|
| Sin `i`, vacío o todo inválido | "Este link no tiene productos" + botón al catálogo |
| Todos los productos no disponibles | Bloque de no disponibles; sin botón de carga; botón al catálogo |
| Qty mayor al stock | Nada especial: se ve en `/carrito` con la cotización, como hoy |
| Más de `MAX_LINEAS` en el link | `normalizarCarrito` recorta; la preview muestra lo que entra |
| Receptor con sesión y carrito en otro dispositivo | El motor ya reconcilia; `ready` evita decidir sobre un snapshot viejo |
| El emisor abre su propio link | Cae en `"igual"` → va a `/carrito` |

## Testing

- `carrito-compartido.test.ts` (node, sin DOM):
  - ida y vuelta `codificarCompartido` → `parsearCompartido`;
  - basura: `null`, `""`, `"a:b"`, `"1:-2"`, `"1:1.5"`, ids largos o con
    caracteres raros, pares duplicados (se unifican), más de 60 líneas;
  - `accionAlCompartir`: vacío, igual en otro orden, distinto.
- Test de la resolución de productos de la página: ids inexistentes, inactivos y
  sin precio terminan en "no disponibles".
- Verificación manual en el navegador: compartir en desktop (copiar), abrir en
  otra sesión con carrito vacío y con carrito lleno (las tres opciones).
