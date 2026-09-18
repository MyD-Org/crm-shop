# Rediseño editorial Central LED — Design

_2026-09-17 · Brainstorming aprobado por Fede_

## Contexto

El shop (Next.js 16, React 19, Tailwind 4) tiene hoy una estética azul/techie
sobre `@myd-org/ui`, y el sitio todavía no abrió al público (hay un opt-in para
simular stock). La referencia aprobada es el mockup
`https://vebyv27hrnrrq.kimi.page/`: una estética **editorial cálida** (crema /
tinta / ámbar / terracota, Fraunces + Nunito Sans) que hay que replicar **con
fidelidad**.

Decisiones tomadas en brainstorming:

| Pregunta | Decisión |
|---|---|
| Motivación | Nueva imagen **y** conversión (recorrido de compra) |
| Alcance | **Toda la tienda pública**: home, catálogo, ficha, carrito, checkout |
| Fidelidad | **Fiel al mockup** |
| Contenido de secciones nuevas | **Administrable desde el inicio** |
| Dónde vive el admin | **Colgado del CRM** (UI en repo CRM, spec aparte) |
| Enfoque técnico | **Evolucionar `@myd-org/ui`** (repo `~/Documents/Fede/ui`) |

## Goals

1. Rediseñar las 5 páginas públicas fiel al mockup, sobre el design system
   evolucionado (v0.11.0).
2. Mejorar la conversión con el nuevo recorrido (cards con add directo, nav por
   categorías reales, secciones de descubrimiento).
3. Home con contenido administrable por el CRM desde el día uno, sin que el
   rediseño quede bloqueado por el CRM.

## Non-goals

- **UI de administración**: se construye en el repo del CRM (spec propio). Este
  spec cubre solo la puerta interna del shop (API + persistencia + render).
- Páginas de cuenta (`mi-cuenta`, `ingresar`, `registro`): no se rediseña su
  contenido; les llega el chrome global nuevo (header/footer).
- Funcionalidades de negocio nuevas: el rediseño no agrega ni quita funciones
  del carrito/checkout/pagos.
- Cambiar el tema default neutral del sistema ni afectar a CRM / ai-widget.

## 1. Design system — `@myd-org/ui` v0.11.0

Repo: `~/Documents/Fede/ui`. Se publica a GitHub Packages y el shop hace bump.

### 1.1 Tema `editorial` (aditivo)

Activado con `data-theme="editorial"` sobre un scope (el layout público del
shop). El default neutral y el tema `.dark` no cambian; consumidores actuales no
se ven afectados.

Tokens del mockup mapeados a roles semánticos (valores exactos):

| Rol | Valor mockup | Uso |
|---|---|---|
| `--color-bg` | `#f7f2ea` | fondo general (cream) |
| `--color-elevated` | `#efe7da` | fondos de foto / bloques (cream-2) |
| `--color-surface` | `#fffcf7` | cards (card) |
| `--color-text` / `--color-primary` | `#33291f` | texto / botones primarios (ink) |
| `--color-muted` | `#8a7a66` | texto secundario (ink-soft) |
| `--color-accent` | `#c07a2b` | ámbar (hover, acentos) |
| `--color-accent-strong` | `#b3603f` | terracota (eyebrow, cuotas en negrita, tags) |
| `--color-border` | `rgba(51,41,31,.14)` | líneas |
| `--color-highlight` *(rol nuevo)* | `#f0c98f` | dorado suave (brand em, acentos en banners/footer oscuro) |
| `--color-accent-soft` *(rol nuevo)* | `#f3e3cb` | fondos de iconos/chips (amber-soft) |
| `--font-sans` | `'Nunito Sans', system-ui, sans-serif` | cuerpo |
| `--font-display` *(rol nuevo)* | `'Fraunces', Georgia, serif` | títulos y precios |

Los roles `--color-highlight`, `--color-accent-soft` y `--font-display` son
nuevos en el sistema; son aditivos y no afectan componentes existentes.

### 1.2 Componentes nuevos

Con stories y tests, siguiendo convenciones del repo (vitest + storybook):

- `SiteHeader` — sticky, search a la izquierda, marca centrada ("Central *Led*"
  en display serif + descriptor small caps), acciones a la derecha (Ingresá,
  cart pill con contador).
- `SiteFooter` — fondo tinta, esquinas superiores redondeadas, 4 columnas
  (marca + rubros + mi cuenta + contacto), barra inferior.
- `Hero` — frame redondeado con imagen, velo degradado crema→transparente,
  eyebrow, H1 display con acento itálico, lead, dos CTAs pill, fila de USPs.
- `RoomTiles` — grilla "Comprá por ambiente" (1 tile grande + 2 apilados, foto,
  caption, link con flecha).
- `PromoBanner` — banner editorial con overlay oscuro y CTA claro.
- `Marquee` — ticker infinito (items serif itálicos con separador ✦).
- `ChipRow` — chips de categorías/tags.
- `ServiceCard` — ícono en tile ámbar + título + texto (fila de servicios).
- `ProductCard` — **variant `editorial`**: foto con tag pill opcional, marca en
  small caps, título, precio en display serif, línea "N cuotas de $X" con monto
  en terracota, botón "+" circular (rota 45°/90° al hover) y slot para
  agregar-al-carrito. No rompe la API actual: es una variant.

## 2. Shop — capa visual

- `globals.css`: importar `tokens.css`/`tailwind.css` del sistema y activar el
  tema editorial en el layout de las páginas públicas (`data-theme`).
- Fuentes con `next/font` (Fraunces + Nunito Sans, weights que use el mockup).
  **Antes de escribir código leer la guía de Next 16 en
  `node_modules/next/dist/docs/`** — el AGENTS.md advierte breaking changes.
- Reescritura de las 5 páginas con los componentes del sistema. **La lógica no
  se toca**: estado de carrito, cotización, Mercado Pago, pedidos, APIs,
  syncs. Cambia solo presentación.
- El `+` del mockup replica el comportamiento real actual de `AddToCartButton`
  (agregar sin salir de la página); no es un link a la ficha.
- Nav de categorías: renderiza categorías reales (endpoint `/api/shop/categorias`
  existente), ordenadas; badge "Nuevo" opcional vía config de home.

## 3. Home content administrable (lado shop)

### 3.1 Persistencia

Tabla `home_content`:

```
key        TEXT PRIMARY KEY
payload    JSONB        -- config de la sección
updated_at TIMESTAMPTZ   -- default now(), refresca en cada upsert
```

Secciones (una fila por key): `anuncio`, `hero`, `marquee`, `ambientes`,
`destacados` (título/cantidad; los productos vienen del API de catálogo),
`bannerDeco`, `decoGrid`, `chips`, `servicios`, `navBadge` (badge "Nuevo" del
nav). Migración con drizzle siguiendo convenciones del repo (`drizzle/`,
`npm run db:generate`).

### 3.2 Contrato interno (CRM → Shop)

```
PUT /api/internal/home-content
Authorization: Bearer $SHOP_CRM_SECRET
Content-Type: application/json

{ "key": "hero", "payload": { ... } }
→ 200 { "ok": true, "key": "hero", "updatedAt": "..." }
```

- Upsert por `key`; valida shape mínimo por sección (rechaza 400 con detalle).
- Espeja el patrón de `src/app/api/internal/cuotas/revalidar`.
- Sin `SHOP_CRM_SECRET` configurado o token inválido → 401/403 (igual que los
  endpoints internos actuales).

### 3.3 Render y fallback

- La home lee la tabla (server component); si está vacía o falta una sección,
  usa **defaults versionados en código** (`src/data/home-defaults.ts`). El sitio
  nunca se rompe y el rediseño no depende del CRM para salir.
- Payloads referencian imágenes por **URL pública**. El storage/upload lo
  resuelve el lado CRM (fuera de scope); el shop no se acopla a storage.
- Set inicial de fotos de ambiente/hero: vive en `/public` del shop (versionado)
  y los defaults apuntan ahí. La config del CRM puede pisarlas con otras URLs.

## 4. Páginas

| Página | Cambio |
|---|---|
| Home | Nueva, con todas las secciones del mockup renderizadas desde `home_content` + defaults |
| Catálogo | Grilla editorial, mismos filtros/búsqueda/paginación actuales |
| Ficha (`producto/[id]`) | Nueva piel: galería, precio display serif, cuotas, CTA; precio/stock en vivo contra Alegra (regla actual) |
| Carrito | Nueva piel del flujo actual |
| Checkout | Nueva piel del flujo actual (MP brick y estados se preservan) |
| Header/Footer | Nuevos y globales (también envuelven mi-cuenta/ingresar/registro) |

## 5. Assets

El mockup usa fotos cálidas de ambiente que el catálogo real no tiene (las
fotos de producto vienen de Alegra, sobre blanco). Se cura un set inicial de
imágenes de ambiente/hero para `anuncio`, `hero`, `ambientes`, `bannerDeco` y
`decoGrid` y se versiona en `/public`. La fuente definitiva de cada imagen es la
config (CRM puede reemplazarlas).

## 6. Verificación

- ui repo: tests de componentes nuevos y stories; `npm run build` del sistema.
- shop: `npm run build`, `npm run lint`, `npm test` (tests de rutas existentes
  en verde) y smoke manual del flujo completo en dev: home → catálogo → ficha →
  carrito → checkout → pago MP sandbox → pedido confirmado.
- Casos de borde chequeados: tabla vacía (defaults), sección parcial (defaults
  por sección), payload inválido (400), token inválido (401/403).

## 7. Orden de implementación

1. **ui**: tokens + tema `editorial` + roles nuevos.
2. **ui**: componentes nuevos con stories/tests → release `0.11.0`.
3. **shop**: bump a `^0.11.0`, globals.css, fuentes, layout con tema.
4. **shop**: header/footer globales nuevos.
5. **shop**: home nueva con defaults estáticos.
6. **shop**: tabla `home_content` + `PUT /api/internal/home-content` + wire del
   render.
7. **shop**: catálogo, ficha, carrito, checkout.
8. Verificación end-to-end (sección 6).

Entre 2 y 3 conviene publicar una versión de desarrollo (`0.11.0-beta.x` o
consumo local con `file:`/`npm pack`) para no bloquear el desarrollo del shop;
detalle a definir en el plan.

## Decisiones abiertas (no bloquean el spec)

- **Storage de imágenes del lado CRM**: el contrato solo exige URLs públicas;
  dónde las hostea el CRM (Blob, S3, etc.) se decide en el spec del CRM.
- **Frecuencia de revalidación de la home**: lectura directa por request
  (como hoy `getOfertaCuotas` con `force-dynamic`) salvo que el plan encuentre
  motivo para cachear.
