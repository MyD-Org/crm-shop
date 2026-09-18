# Plan — Shop: rediseño editorial Central LED

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar las 5 páginas públicas del shop con el tema editorial de `@myd-org/ui` v0.11, header/footer globales, y contenido de home administrable por el CRM (tabla `home_content` + `PUT /api/internal/home-content` + defaults en código).

**Architecture:** El tema `editorial` se activa en `<html data-theme="editorial">` y re-calcula todos los tokens semánticos; los componentes del DS que ya leen roles (`bg-primary`, `text-muted`, …) se re-pintan solos. El rediseño es de presentación: la lógica existente (CartContext en localStorage, useCotizacion, idempotencia del checkout, MP brick, syncs) NO se toca. La home lee `home_content` (DB) mergeada con defaults versionados en `src/data/home-defaults.ts`; si la tabla está vacía o un payload no valida, se usa el default de esa sección.

**Tech Stack:** Next.js 16.2.9 (Turbopack), React 19, Tailwind 4, `@myd-org/ui` ^0.11.0, drizzle-orm + Postgres, vitest (node), Clerk.

**Working directory:** `~/Documents/Fede/Shop`.

**Spec:** `docs/superpowers/specs/2026-09-17-rediseno-editorial-design.md` · **Prerequisito duro:** el plan `2026-09-18-ui-editorial-theme.md` publicado (`@myd-org/ui@0.11.0` en GitHub Packages). Si todavía no está publicado, instalar el tarball local (`npm pack` en el repo ui + `npm install <tgz>` acá) y al final volver a `npm install @myd-org/ui@^0.11.0`.

**Regla de oro del AGENTS.md:** antes de escribir código de Next, consultar `node_modules/next/dist/docs/` (01-app/01-getting-started/13-fonts.md ya fue verificado: `next/font/google` sin cambios de API; params/searchParams async; `proxy` en vez de middleware).

**Antes de arrancar:**
```bash
git checkout main && git pull --rebase   # main divergió: 1 commit remoto vs nuestro commit del spec
git checkout -b rediseno-editorial
npm install @myd-org/ui@^0.11.0
```

**Convenciones del repo a respetar:** tests con vitest en entorno **node** (sin DOM; solo lógica pura y rutas — para rutas se mockea el lib con `vi.mock`, ver `src/app/api/internal/cuotas/revalidar/route.test.ts`). Alias `@ → ./src`. Auth interna con `bearerMatches` (`src/lib/secure-compare.ts`). Lectura DB por request con `cache()` de React + try/catch que devuelve fallback (ver `src/lib/cuotas-datos.ts`).

---

### Task 1: Fuentes + tema editorial global

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Reescribir `globals.css` completo**

Reemplazar todo el contenido por:

```css
@import "tailwindcss";
@import "@myd-org/ui/tailwind.css";
@source "../../node_modules/@myd-org/ui/dist";

/* El tema editorial (crema/tinta/ámbar) viene del design system v0.11
   ([data-theme='editorial'], activado en <html> del layout). Acá solo se
   cablean las fuentes cargadas con next/font a los roles del DS. */
:root {
  --font-sans: var(--font-nunito), ui-sans-serif, system-ui, -apple-system, sans-serif;
}

[data-theme="editorial"] {
  --font-sans: var(--font-nunito), ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-display: var(--font-fraunces), Georgia, serif;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
}

.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
```

(Opcional, recomendado: agregar `@custom-variant dark (&:where(.dark, .dark *));` si en el futuro se usa dark mode; NO es necesario ahora.)

- [ ] **Step 2: Reescribir `src/app/layout.tsx`**

Mantener el export `metadata` actual **sin cambios** (title "Central LED — Tienda Online" + facebook-domain-verification). El resto del archivo queda:

```tsx
import { ClerkProvider } from "@clerk/nextjs";
import { esAR } from "@/lib/clerk-localizacion";
import { Fraunces, Nunito_Sans } from "next/font/google";
import { Header } from "@/components/HeaderServer";
import { Providers } from "@/components/Providers";
import "./globals.css";

const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      data-theme="editorial"
      className={`h-full antialiased ${nunito.variable} ${fraunces.variable}`}
    >
      <body className="flex min-h-full flex-col">
        {/* ClerkProvider DENTRO de <body>: envolver <html> fuerza render dinámico de todo el árbol */}
        <ClerkProvider localization={esAR}>
          <Providers>
            <Header />
            {children}
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
```

Notas:
- El `<SiteFooter />` global se agrega en la Task 2 (todavía no existe; sumarlo ahora rompería el build).
- Si `next build` protesta por ejes de Fraunces (es variable con opsz), agregar `axes: ["opsz"]` a la config de Fraunces (documentado en `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md`).

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila (fuentes incluidas).

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "feat(theme): activa tema editorial + fuentes Fraunces/Nunito Sans"
```

---

### Task 2: Footer global nuevo (`SiteFooter` + layout, se elimina el viejo)

**Files:**
- Create: `src/components/SiteFooter.tsx`
- Delete: `src/components/Footer.tsx`
- Modify: `src/app/layout.tsx` (ya hecho en Task 1 — verificar que importe el nuevo)
- Modify: `src/components/HomeClient.tsx` (sacar `<Footer />`)
- Modify: `src/app/checkout/page.tsx` (sacar `<Footer />`)
- Modify: `src/app/mi-cuenta/page.tsx`, `src/app/mi-cuenta/pedido/[id]/page.tsx`, `src/app/mi-cuenta/vincular/page.tsx` (sacar `<Footer />` donde aparezca)

- [ ] **Step 1: Crear `src/components/SiteFooter.tsx`**

```tsx
import { SiteFooter as SiteFooterDS } from "@myd-org/ui";

/**
 * Footer global del layout. Links reales (el footer anterior tenía hrefs rotos
 * a /cuenta/* y /envios). Rubros hardcodeados: son las categorías canónica del
 * negocio (mismo criterio que el footer viejo).
 */
export function SiteFooter() {
  const anio = new Date().getFullYear();
  return (
    <SiteFooterDS
      brandName="Central"
      brandAccent="Led"
      description="Materiales eléctricos e iluminación en Puerto Iguazú, Misiones. Venta mayorista y minorista con amor por la luz."
      columns={[
        {
          title: "Rubros",
          links: [
            { label: "Iluminación LED", href: "/catalogo?categoria=Iluminaci%C3%B3n+LED" },
            { label: "Tableros", href: "/catalogo?categoria=Tableros" },
            { label: "Cables", href: "/catalogo?categoria=Cables" },
            { label: "Automatización", href: "/catalogo?categoria=Automatizaci%C3%B3n" },
          ],
        },
        {
          title: "Tienda",
          links: [
            { label: "Catálogo", href: "/catalogo" },
            { label: "Carrito", href: "/carrito" },
            { label: "Ingresar", href: "/ingresar" },
          ],
        },
        {
          title: "Mi cuenta",
          links: [
            { label: "Mis pedidos", href: "/mi-cuenta" },
            { label: "Vincular mi cuenta", href: "/mi-cuenta/vincular" },
          ],
        },
      ]}
      barLeft={`© ${anio} Central Led — Puerto Iguazú, Misiones`}
      barRight="Hecho con luz en Misiones"
    />
  );
}
```

- [ ] **Step 2: Montar el footer en el layout y quitar los montajes viejos**

En `src/app/layout.tsx`: agregar el import `import { SiteFooter } from "@/components/SiteFooter";` y renderar `<SiteFooter />` dentro de `<Providers>`, después de `{children}`.

Luego, en `HomeClient.tsx` eliminar el import de `./Footer` y la línea `<Footer />` (línea ~326). En `checkout/page.tsx` y en las páginas de `mi-cuenta` eliminar import y uso igual.

Verificación: `git grep -n "Footer" src/` debe listar SOLO `src/components/SiteFooter.tsx` y `src/app/layout.tsx`. Luego borrar el archivo viejo:

```bash
rm src/components/Footer.tsx
```

- [ ] **Step 3: Verificar build**

Run: `npm run build` → compila. Smoke visual: `npm run dev`, abrir cualquier página: el footer nuevo aparece al pie en crema/tinta, en TODAS las páginas.

- [ ] **Step 4: Commit**

```bash
git add -A src/components/SiteFooter.tsx src/components/Footer.tsx src/components/HomeClient.tsx src/app
git commit -m "feat(layout): footer editorial global, links reales"
```

---

### Task 3: Header nuevo con `SiteHeader` del DS

**Files:**
- Modify: `src/components/HeaderUI.tsx` (reescritura completa)

- [ ] **Step 1: Reescribir `src/components/HeaderUI.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { SiteHeader } from "@myd-org/ui";
import { SearchAutocomplete } from "./SearchAutocomplete";
import { destinoSeguro } from "@/lib/ingreso";
import { CartPreview } from "./CartPreview";

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function HeaderUI({
  nombre,
  categorias,
}: {
  /** Razon social del cliente, o el nombre de la cuenta. null = anonimo. */
  nombre: string | null;
  /** Categorias reales del catalogo, resueltas en HeaderServer. */
  categorias: string[];
}) {
  const pathname = usePathname();
  // En "Mi cuenta" ocultamos la barra de categorias para que se sienta una
  // seccion propia y no de tienda.
  const hideCategorias = pathname?.startsWith("/mi-cuenta");

  return (
    <div className="bg-bg">
      {/* La barra de anuncio vive en la home (contenido administrable); acá solo
          va el header+nav globales. */}
      <SiteHeader
        brandName="Central"
        brandAccent="Led"
        brandSub="Iluminación · Electricidad"
        search={<SearchAutocomplete />}
        actions={
          <>
            <Show when="signed-out">
              {/*
                `mode="modal"` en vez de navegar a /ingresar: el cliente puede
                estar a mitad del carrito, y sacarlo de la pagina para loguearse
                es donde se pierden las compras.
              */}
              <SignInButton
                mode="modal"
                fallbackRedirectUrl={destinoSeguro(pathname)}
                signUpFallbackRedirectUrl={destinoSeguro(pathname)}
              >
                <button className="flex items-center gap-2 text-[13.5px] font-bold text-text transition-colors hover:text-accent">
                  <UserIcon />
                  Ingresá
                </button>
              </SignInButton>
            </Show>

            <Show when="signed-in">
              <Link
                href="/mi-cuenta"
                className="flex items-center gap-2 text-[13.5px] font-bold text-text transition-colors hover:text-accent"
              >
                <UserIcon />
                <span className="hidden max-w-[14ch] truncate sm:inline">
                  {nombre ?? "Mi cuenta"}
                </span>
              </Link>
              <UserButton />
            </Show>

            <CartPreview />
          </>
        }
        nav={
          hideCategorias
            ? []
            : categorias.slice(0, 8).map((cat) => ({
                label: cat,
                href: `/catalogo?categoria=${encodeURIComponent(cat)}`,
              }))
        }
      />
    </div>
  );
}
```

Lo que se preserva del header viejo (no tocar): `SignInButton mode="modal"` con `destinoSeguro(pathname)` (crítico: vuelve a la página tras el login con Google), `Show` signed-out/signed-in, `UserButton`, `CartPreview` (lee el count del contexto), el hide de categorías en `/mi-cuenta`, `HeaderServer` intacto (sigue pasando `nombre` y `categorias`).

- [ ] **Step 2: Verificar build + smoke**

Run: `npm run build` → compila. En dev: header sticky crema con marca serif centrada, search a la izquierda, nav con categorías reales; el count del carrito sigue andando (agregar un producto y verificar).

- [ ] **Step 3: Commit**

```bash
git add src/components/HeaderUI.tsx
git commit -m "feat(header): header editorial con SiteHeader del DS"
```

---

### Task 4: Defaults y validadores de contenido de home

**Files:**
- Create: `src/data/home-defaults.ts`
- Test: `src/data/home-defaults.test.ts`

- [ ] **Step 1: Test que falla**

`src/data/home-defaults.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULTS_HOME,
  SECCIONES_HOME,
  erroresSeccion,
  combinarContenidoHome,
} from "./home-defaults";

describe("defaults de home", () => {
  it("todas las secciones default validan sin errores", () => {
    for (const key of SECCIONES_HOME) {
      if (key === "navBadge") continue; // null = sin badge
      expect(erroresSeccion(key, DEFAULTS_HOME[key as keyof typeof DEFAULTS_HOME])).toEqual([]);
    }
  });

  it("navBadge default es null", () => {
    expect(DEFAULTS_HOME.navBadge).toBeNull();
  });
});

describe("erroresSeccion", () => {
  it("rechaza sección desconocida", () => {
    expect(erroresSeccion("zzz", {}).length).toBeGreaterThan(0);
  });

  it("hero exige titulo e imagen", () => {
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, titulo: 42 }).length).toBeGreaterThan(0);
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, imagen: "" }).length).toBeGreaterThan(0);
  });

  it("destacados valida cantidad entre 1 y 24", () => {
    expect(erroresSeccion("destacados", { ...DEFAULTS_HOME.destacados, cantidad: 0 }).length).toBeGreaterThan(0);
    expect(erroresSeccion("destacados", { ...DEFAULTS_HOME.destacados, cantidad: 99 }).length).toBeGreaterThan(0);
  });

  it("navBadge acepta null (borrar badge)", () => {
    expect(erroresSeccion("navBadge", null)).toEqual([]);
  });

  it("enlaces exigen label y href", () => {
    expect(
      erroresSeccion("decoGrid", {
        ...DEFAULTS_HOME.decoGrid,
        chips: [{ label: "x" }],
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe("combinarContenidoHome", () => {
  it("con filas vacías devuelve los defaults", () => {
    expect(combinarContenidoHome([])).toEqual(DEFAULTS_HOME);
  });

  it("una fila válida pisa solo su sección", () => {
    const hero = { ...DEFAULTS_HOME.hero, titulo: "Otro título" };
    const out = combinarContenidoHome([{ key: "hero", payload: hero }]);
    expect(out.hero.titulo).toBe("Otro título");
    expect(out.anuncio).toEqual(DEFAULTS_HOME.anuncio);
  });

  it("un payload inválido se ignora y queda el default", () => {
    const out = combinarContenidoHome([{ key: "hero", payload: { roto: true } }]);
    expect(out.hero).toEqual(DEFAULTS_HOME.hero);
  });

  it("una key desconocida se ignora", () => {
    const out = combinarContenidoHome([{ key: "zzz", payload: {} }]);
    expect(out).toEqual(DEFAULTS_HOME);
  });

  it("navBadge null se conserva como null", () => {
    const out = combinarContenidoHome([
      { key: "navBadge", payload: { categoria: "Decorativa", texto: "Nuevo" } },
    ]);
    expect(out.navBadge).toEqual({ categoria: "Decorativa", texto: "Nuevo" });
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/data/home-defaults.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/data/home-defaults.ts`**

```ts
/**
 * Contenido por defecto de la home, editable después desde el CRM vía
 * PUT /api/internal/home-content. Cada sección de la DB pisa a su default
 * solo si valida (ver erroresSeccion). Las imágenes default son placeholders
 * SVG inline (data URI) en la paleta editorial: se reemplazan desde el CRM
 * por URLs públicas de fotos reales.
 */

export type Enlace = { label: string; href: string };

export type HeroContent = {
  eyebrow: string;
  titulo: string;
  acento?: string;
  bajada: string;
  imagen: string;
  imagenAlt: string;
  ctas: Enlace[];
  usps: { label: string }[];
};

export type MarqueeContent = { items: string[] };

export type TileContent = {
  eyebrow: string;
  titulo: string;
  imagen: string;
  href: string;
};

export type SeccionTilesContent = {
  titulo: string;
  acento?: string;
  bajada?: string;
  linkTodos: string;
  items: TileContent[];
};

export type DestacadosContent = {
  titulo: string;
  acento?: string;
  bajada?: string;
  linkTodos: string;
  cantidad: number;
};

export type BannerDecoContent = {
  eyebrow: string;
  titulo: string;
  acento?: string;
  bajada: string;
  cta: Enlace;
  imagen: string;
};

export type DecoGridContent = {
  titulo: string;
  acento?: string;
  linkTodos: string;
  items: TileContent[];
  chips: Enlace[];
};

export type ServiciosContent = { items: { titulo: string; texto: string }[] };
export type NavBadgeContent = { categoria: string; texto: string };

export type HomeContent = {
  anuncio: { texto: string };
  hero: HeroContent;
  marquee: MarqueeContent;
  ambientes: SeccionTilesContent;
  destacados: DestacadosContent;
  bannerDeco: BannerDecoContent;
  decoGrid: DecoGridContent;
  servicios: ServiciosContent;
  /** null = la categoría del nav no lleva badge. */
  navBadge: NavBadgeContent | null;
};

export const SECCIONES_HOME = [
  "anuncio",
  "hero",
  "marquee",
  "ambientes",
  "destacados",
  "bannerDeco",
  "decoGrid",
  "servicios",
  "navBadge",
] as const;

export type SeccionHome = (typeof SECCIONES_HOME)[number];

/** Placeholder SVG en paleta editorial (crema→ámbar suave) como data URI. */
function svgPlaceholder(desde: string, hacia: string, etiqueta: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${desde}"/><stop offset="1" stop-color="${hacia}"/>` +
    `</linearGradient></defs>` +
    `<rect width="1200" height="900" fill="url(#g)"/>` +
    `<circle cx="880" cy="240" r="150" fill="#f0c98f" opacity="0.4"/>` +
    `<circle cx="240" cy="700" r="90" fill="#b3603f" opacity="0.18"/>` +
    `<text x="60" y="830" font-family="Georgia, serif" font-size="46" fill="#8a7a66">${etiqueta}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const PLACEHOLDER = {
  hero: svgPlaceholder("#efe7da", "#f3e3cb", "Living cálido"),
  colgantes: svgPlaceholder("#f3e3cb", "#efe7da", "Colgantes"),
  patio: svgPlaceholder("#e8dcc8", "#efe7da", "Patio y jardín"),
  dormitorio: svgPlaceholder("#efe7da", "#e8dcc8", "Dormitorio"),
  patioAnochecer: svgPlaceholder("#d9c7ad", "#b3603f", "Patio al atardecer"),
  guirnaldas: svgPlaceholder("#efe7da", "#f3e3cb", "Guirnaldas"),
  neones: svgPlaceholder("#e8dcc8", "#efe7da", "Neones y tiras"),
  veladores: svgPlaceholder("#f3e3cb", "#efe7da", "Veladores"),
};

export const DEFAULTS_HOME: HomeContent = {
  anuncio: {
    texto: "Envío gratis en compras desde $100.000 · 6 cuotas sin interés · Retiro en local sin cargo",
  },
  hero: {
    eyebrow: "Nueva colección 2026",
    titulo: "La luz que hace",
    acento: "hogar",
    bajada:
      "Lámparas, paneles, cables y todo para tu instalación. Stock real, marcas líderes y precios mayoristas.",
    imagen: PLACEHOLDER.hero,
    imagenAlt: "Ambiente cálido iluminado",
    ctas: [
      { label: "Ver catálogo →", href: "/catalogo" },
      { label: "Ofertas", href: "/catalogo?orden=ventas" },
    ],
    usps: [
      { label: "Envíos a todo el país" },
      { label: "Stock en tiempo real" },
      { label: "Asesoramiento por WhatsApp" },
    ],
  },
  marquee: {
    items: [
      "Más de 5.000 productos",
      "Despacho en 24 h",
      "Precios mayoristas",
      "Puerto Iguazú, Misiones",
    ],
  },
  ambientes: {
    titulo: "Comprá por",
    acento: "ambiente",
    bajada: "Encontrá la solución ideal para cada rincón de tu casa o proyecto.",
    linkTodos: "/catalogo",
    items: [
      { eyebrow: "Interior", titulo: "Colgantes y lámparas de diseño", imagen: PLACEHOLDER.colgantes, href: "/catalogo" },
      { eyebrow: "Exterior", titulo: "Patio y jardín", imagen: PLACEHOLDER.patio, href: "/catalogo" },
      { eyebrow: "Interior", titulo: "Dormitorio", imagen: PLACEHOLDER.dormitorio, href: "/catalogo" },
    ],
  },
  destacados: {
    titulo: "Los más",
    acento: "queridos",
    bajada: "Los productos que eligen nuestros clientes, con stock confirmado y cuotas.",
    linkTodos: "/catalogo",
    cantidad: 4,
  },
  bannerDeco: {
    eyebrow: "Línea decorativa",
    titulo: "Ambientá tus noches con",
    acento: "luz cálida",
    bajada: "Guirnaldas, neones, veladores y colgantes para transformar cualquier espacio.",
    cta: { label: "Descubrir la línea →", href: "/catalogo" },
    imagen: PLACEHOLDER.patioAnochecer,
  },
  decoGrid: {
    titulo: "Decorativa para",
    acento: "cada rincón",
    linkTodos: "/catalogo",
    items: [
      { eyebrow: "Exterior", titulo: "Guirnaldas", imagen: PLACEHOLDER.guirnaldas, href: "/catalogo" },
      { eyebrow: "Interior", titulo: "Neones y tiras", imagen: PLACEHOLDER.neones, href: "/catalogo" },
      { eyebrow: "Interior", titulo: "Veladores", imagen: PLACEHOLDER.veladores, href: "/catalogo" },
      { eyebrow: "Interior", titulo: "Colgantes", imagen: PLACEHOLDER.colgantes, href: "/catalogo" },
    ],
    chips: [
      { label: "Apliques de pared", href: "/catalogo" },
      { label: "Faroles solares", href: "/catalogo" },
      { label: "Smart / Wi-Fi", href: "/catalogo" },
      { label: "Efecto fuego", href: "/catalogo" },
      { label: "Listones y tubos", href: "/catalogo" },
    ],
  },
  servicios: {
    items: [
      { titulo: "Envío gratis", texto: "En compras desde $100.000 a todo el país." },
      { titulo: "Stock real", texto: "Sincronizado al instante con nuestro depósito." },
      { titulo: "6 cuotas sin interés", texto: "Y precios especiales por transferencia." },
      { titulo: "Asesoramiento", texto: "Te ayudamos a elegir bien." },
    ],
  },
  navBadge: null,
};

// ---------------------------------------------------------------------------
// Validación mínima por sección (contrato del PUT /api/internal/home-content)
// ---------------------------------------------------------------------------

function esTexto(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function esEnlace(v: unknown): v is Enlace {
  const o = v as Enlace;
  return !!v && typeof v === "object" && esTexto(o.label) && esTexto(o.href);
}

function esTile(v: unknown): v is TileContent {
  const o = v as TileContent;
  return !!v && typeof v === "object" && esTexto(o.eyebrow) && esTexto(o.titulo) && esTexto(o.imagen) && esTexto(o.href);
}

/** Devuelve la lista de problemas del payload para la sección ([] = válido). */
export function erroresSeccion(key: string, payload: unknown): string[] {
  if (key === "navBadge") {
    if (payload === null) return [];
    const o = payload as NavBadgeContent;
    return !!payload && typeof payload === "object" && esTexto(o.categoria) && esTexto(o.texto)
      ? []
      : ["navBadge debe ser null o { categoria, texto }"];
  }

  if (!(SECCIONES_HOME as readonly string[]).includes(key)) {
    return [`sección desconocida: ${key}`];
  }
  if (!payload || typeof payload !== "object") return ["payload debe ser un objeto"];

  const o = payload as Record<string, unknown>;
  const errores: string[] = [];
  const texto = (campo: string, opcional = false) => {
    if (opcional && (o[campo] === undefined || o[campo] === null)) return;
    if (!esTexto(o[campo])) errores.push(`${campo} debe ser un texto no vacío`);
  };

  switch (key) {
    case "anuncio":
      texto("texto");
      break;
    case "hero": {
      texto("eyebrow");
      texto("titulo");
      texto("acento", true);
      texto("bajada");
      texto("imagen");
      if (!Array.isArray(o.ctas) || !o.ctas.every(esEnlace)) errores.push("ctas debe ser un array de { label, href }");
      if (!Array.isArray(o.usps) || o.usps.length === 0 || !(o.usps as { label?: unknown }[]).every((u) => esTexto(u?.label)))
        errores.push("usps debe ser un array no vacío de { label }");
      break;
    }
    case "marquee":
      if (!Array.isArray(o.items) || o.items.length === 0 || !(o.items as unknown[]).every(esTexto))
        errores.push("items debe ser un array no vacío de textos");
      break;
    case "ambientes":
    case "decoGrid": {
      texto("titulo");
      texto("acento", true);
      if (key === "ambientes") texto("bajada", true);
      if (!esTexto(o.linkTodos)) errores.push("linkTodos debe ser un texto no vacío");
      if (!Array.isArray(o.items) || o.items.length === 0 || !o.items.every(esTile))
        errores.push("items debe ser un array no vacío de tiles { eyebrow, titulo, imagen, href }");
      if (key === "decoGrid" && (!Array.isArray(o.chips) || !o.chips.every(esEnlace)))
        errores.push("chips debe ser un array de { label, href }");
      break;
    }
    case "destacados": {
      texto("titulo");
      texto("acento", true);
      texto("bajada", true);
      if (!esTexto(o.linkTodos)) errores.push("linkTodos debe ser un texto no vacío");
      if (typeof o.cantidad !== "number" || o.cantidad < 1 || o.cantidad > 24)
        errores.push("cantidad debe ser un número entre 1 y 24");
      break;
    }
    case "bannerDeco": {
      texto("eyebrow");
      texto("titulo");
      texto("acento", true);
      texto("bajada");
      texto("imagen");
      if (!esEnlace(o.cta)) errores.push("cta debe ser { label, href }");
      break;
    }
    case "servicios":
      if (!Array.isArray(o.items) || o.items.length === 0 ||
          !(o.items as { titulo?: unknown; texto?: unknown }[]).every((s) => esTexto(s?.titulo) && esTexto(s?.texto)))
        errores.push("items debe ser un array no vacío de { titulo, texto }");
      break;
  }
  return errores;
}

/** Payload usable para la sección, o null si hay que quedarse con el default. */
export function resolverSeccion(key: string, payload: unknown): unknown {
  if (!(SECCIONES_HOME as readonly string[]).includes(key)) return null;
  return erroresSeccion(key, payload).length === 0 ? payload : null;
}

/** Mergea filas de la DB sobre los defaults, sección por sección. */
export function combinarContenidoHome(filas: { key: string; payload: unknown }[]): HomeContent {
  const porKey = new Map(filas.map((f) => [f.key, f.payload]));
  const resultado: HomeContent = { ...DEFAULTS_HOME };
  for (const key of SECCIONES_HOME) {
    if (!porKey.has(key)) continue;
    const payload = resolverSeccion(key, porKey.get(key));
    if (payload !== null) {
      Object.assign(resultado, { [key]: payload });
    } else if (key === "navBadge") {
      resultado.navBadge = null;
    }
  }
  return resultado;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/data/home-defaults.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/data/home-defaults.ts src/data/home-defaults.test.ts
git commit -m "feat(home): defaults + validadores de contenido de home"
```

---

### Task 5: Tabla `home_content` (schema + migración)

**Files:**
- Modify: `src/db/schema.ts` (agregar tabla)
- Create: `drizzle/0010_*.sql` (generado)

- [ ] **Step 1: Agregar la tabla al schema**

En `src/db/schema.ts` (al final, junto a `paymentConfigCache`; respetar el import existente de `text`, `jsonb`, `timestamp` — ya están importados para otras tablas):

```ts
/** Contenido administrable de la home. Una fila por sección; el CRM escribe vía
 *  PUT /api/internal/home-content y la home la mergea con defaults en código. */
export const homeContent = pgTable("home_content", {
  key: text("key").primaryKey(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Generar y aplicar la migración**

```bash
npm run db:generate   # crea drizzle/0010_<nombre>.sql con CREATE TABLE "home_content"
npm run db:migrate    # la aplica contra la base del .env.local
```

Expected: `db:generate` imprime `CREATE TABLE "home_content"` con `key text PRIMARY KEY`, `payload jsonb NOT NULL`, `updated_at timestamp with time zone DEFAULT now() NOT NULL`. Si el nombre generado no describe nada, aceptarlo igual (el repo ya mezcla nombres auto y manuales; no renombrar para no desajustar `_journal.json`).

Verificar en la base:

```bash
node -e "const{execSync}=require('child_process');" 2>/dev/null; npm run db:migrate
```

(Comprobación real en la Task 7, cuando el endpoint escribe una fila.)

- [ ] **Step 3: typecheck + Commit**

Run: `npm run typecheck` → ok.

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): tabla home_content"
```

---

### Task 6: `getContenidoHome` (lectura por request con fallback)

**Files:**
- Create: `src/lib/home-datos.ts`
- Test: `src/lib/home-datos.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { describe, expect, it } from "vitest";
import { combinarContenidoHome } from "./home-datos";
import { DEFAULTS_HOME } from "@/data/home-defaults";

describe("combinarContenidoHome (lib)", () => {
  it("filas vacías → defaults", () => {
    expect(combinarContenidoHome([])).toEqual(DEFAULTS_HOME);
  });

  it("merge por sección con defaults", () => {
    const hero = { ...DEFAULTS_HOME.hero, titulo: "Título del CRM" };
    const out = combinarContenidoHome([
      { key: "hero", payload: hero },
      { key: "anuncio", payload: { malo: 1 } },
    ]);
    expect(out.hero.titulo).toBe("Título del CRM");
    expect(out.anuncio).toEqual(DEFAULTS_HOME.anuncio);
    expect(out.destacados).toEqual(DEFAULTS_HOME.destacados);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/lib/home-datos.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/lib/home-datos.ts`**

```ts
import { cache } from "react";
import { getDb } from "@/db";
import { homeContent } from "@/db/schema";
import {
  combinarContenidoHome as combinar,
  type HomeContent,
} from "@/data/home-defaults";

export function combinarContenidoHome(filas: { key: string; payload: unknown }[]): HomeContent {
  return combinar(filas);
}

/**
 * Contenido de la home para este request. Lee home_content y mergea con
 * defaults; si la DB falla o está vacía, los defaults hacen que la home
 * nunca se rompa. Igual criterio que getOfertaCuotas (cache por request,
 * fallback en error).
 */
export const getContenidoHome = cache(async (): Promise<HomeContent> => {
  try {
    const filas = await getDb().select().from(homeContent);
    return combinar(filas);
  } catch (err) {
    console.error("[home] home_content no disponible, uso defaults:", err);
    const { DEFAULTS_HOME } = await import("@/data/home-defaults");
    return DEFAULTS_HOME;
  }
});
```

- [ ] **Step 4: Correr tests + suite completa**

Run: `npx vitest run src/lib/home-datos.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/home-datos.ts src/lib/home-datos.test.ts
git commit -m "feat(home): getContenidoHome con fallback a defaults"
```

---

### Task 7: `PUT /api/internal/home-content` (la puerta del CRM)

**Files:**
- Create: `src/lib/home-guardar.ts`
- Create: `src/app/api/internal/home-content/route.ts`
- Test: `src/app/api/internal/home-content/route.test.ts`
- Modify: `src/proxy.ts:18` (RUTAS_PUBLICAS)

- [ ] **Step 1: Test de la ruta que falla**

`src/app/api/internal/home-content/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { guardarMock, borrarMock } = vi.hoisted(() => ({
  guardarMock: vi.fn(),
  borrarMock: vi.fn(),
}));

vi.mock("@/lib/home-guardar", () => ({
  guardarSeccionHome: guardarMock,
  borrarSeccionHome: borrarMock,
}));

import { PUT } from "./route";

function req(body: unknown, token?: string) {
  return new Request("http://localhost/api/internal/home-content", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/internal/home-content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOP_CRM_SECRET = "secreto-test";
    guardarMock.mockResolvedValue({ updatedAt: new Date("2026-09-18T00:00:00Z") });
    borrarMock.mockResolvedValue(undefined);
  });

  it("401 sin token y con token incorrecto (y no guarda nada)", async () => {
    expect((await PUT(req({ key: "anuncio", payload: { texto: "x" } }))).status).toBe(401);
    expect((await PUT(req({ key: "anuncio", payload: { texto: "x" } }, "malo"))).status).toBe(401);
    expect(guardarMock).not.toHaveBeenCalled();
    expect(borrarMock).not.toHaveBeenCalled();
  });

  it("400 con JSON roto", async () => {
    const r = await PUT(
      new Request("http://localhost/api/internal/home-content", {
        method: "PUT",
        headers: { authorization: "Bearer secreto-test" },
        body: "{roto",
      }),
    );
    expect(r.status).toBe(400);
  });

  it("400 con key desconocida", async () => {
    const r = await PUT(req({ key: "zzz", payload: {} }, "secreto-test"));
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.detalles[0]).toContain("sección desconocida");
  });

  it("400 con payload inválido y detalles", async () => {
    const r = await PUT(req({ key: "hero", payload: { titulo: 42 } }, "secreto-test"));
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.detalles.length).toBeGreaterThan(0);
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("200 guarda una sección válida", async () => {
    const payload = { texto: "Envío gratis desde $150.000" };
    const r = await PUT(req({ key: "anuncio", payload }, "secreto-test"));
    expect(r.status).toBe(200);
    expect(guardarMock).toHaveBeenCalledWith("anuncio", payload);
  });

  it("navBadge null borra la fila (badge apagado)", async () => {
    const r = await PUT(req({ key: "navBadge", payload: null }, "secreto-test"));
    expect(r.status).toBe(200);
    expect(borrarMock).toHaveBeenCalledWith("navBadge");
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/app/api/internal/home-content/route.test.ts` → FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `src/lib/home-guardar.ts`**

```ts
import { getDb } from "@/db";
import { homeContent } from "@/db/schema";

/** Upsert de una sección de home. Llama solo desde la API interna (CRM). */
export async function guardarSeccionHome(
  key: string,
  payload: unknown,
): Promise<{ updatedAt: Date }> {
  const [fila] = await getDb()
    .insert(homeContent)
    .values({ key, payload: payload as Record<string, unknown> })
    .onConflictDoUpdate({
      target: homeContent.key,
      set: { payload: payload as Record<string, unknown>, updatedAt: new Date() },
    })
    .returning({ updatedAt: homeContent.updatedAt });
  return fila;
}

/** Elimina la fila de una sección (vuelve al default). */
export async function borrarSeccionHome(key: string): Promise<void> {
  await getDb().delete(homeContent).where(eq(homeContent.key, key));
}
```

Agregar `import { eq } from "drizzle-orm";` al inicio.

- [ ] **Step 4: Implementar la ruta `src/app/api/internal/home-content/route.ts`**

```ts
import { NextResponse } from "next/server";
import { SECCIONES_HOME, erroresSeccion } from "@/data/home-defaults";
import { guardarSeccionHome, borrarSeccionHome } from "@/lib/home-guardar";
import { bearerMatches } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

/**
 * Puerta de escritura del CRM hacia el contenido de la home del shop.
 * Mismo contrato de auth que /api/internal/cuotas/revalidar: Bearer
 * SHOP_CRM_SECRET. Body: { key, payload } — ver SECCIONES_HOME en
 * src/data/home-defaults.
 */
export async function PUT(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.SHOP_CRM_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido: se esperaba JSON" }, { status: 400 });
  }

  const { key, payload } = (body ?? {}) as { key?: unknown; payload?: unknown };

  if (typeof key !== "string" || !(SECCIONES_HOME as readonly string[]).includes(key)) {
    return NextResponse.json(
      { error: "key inválida", detalles: [`key debe ser una de: ${SECCIONES_HOME.join(", ")}`] },
      { status: 400 },
    );
  }

  // navBadge: null = apagar el badge (borrar la fila → vuelve al default null).
  if (key === "navBadge" && payload === null) {
    await borrarSeccionHome(key);
    return NextResponse.json({ ok: true, key, updatedAt: null });
  }

  const detalles = erroresSeccion(key, payload);
  if (detalles.length > 0) {
    return NextResponse.json({ error: "payload inválido", detalles }, { status: 400 });
  }

  const guardado = await guardarSeccionHome(key, payload);
  return NextResponse.json({ ok: true, key, updatedAt: guardado.updatedAt });
}
```

- [ ] **Step 5: Excluir la ruta del site-gate (`src/proxy.ts`)**

El gate responde HTML con 200 a cualquier ruta si no hay cookie — el CRM recibiría el cartel de "Próximamente" y daría por guardado algo que no se guardó (misma clase de falla que documenta el caso del webhook MP). En `src/proxy.ts` línea 18 cambiar:

```ts
const RUTAS_PUBLICAS = ["/api/pagos/mercadopago/webhook"];
```

por:

```ts
const RUTAS_PUBLICAS = [
  "/api/pagos/mercadopago/webhook",
  // La escribe el CRM (Bearer SHOP_CRM_SECRET): no tiene cookie de gate.
  "/api/internal/home-content",
];
```

- [ ] **Step 6: Correr tests + suite completa**

Run: `npx vitest run src/app/api/internal/home-content/route.test.ts && npm test`
Expected: PASS.

- [ ] **Step 7: Smoke real con curl (dev server corriendo)**

```bash
# 401 sin token
curl -s -X PUT localhost:3000/api/internal/home-content -H 'content-type: application/json' -d '{"key":"anuncio","payload":{"texto":"x"}}'
# 200 con token (usar el SHOP_CRM_SECRET del .env.local)
curl -s -X PUT localhost:3000/api/internal/home-content -H "authorization: Bearer $SHOP_CRM_SECRET" -H 'content-type: application/json' -d '{"key":"anuncio","payload":{"texto":"Envío gratis en compras desde $150.000"}}'
# 400 payload roto
curl -s -X PUT localhost:3000/api/internal/home-content -H "authorization: Bearer $SHOP_CRM_SECRET" -H 'content-type: application/json' -d '{"key":"hero","payload":{"titulo":42}}'
```

Recargar la home y ver el anuncio nuevo.

- [ ] **Step 8: Commit**

```bash
git add src/lib/home-guardar.ts src/app/api/internal/home-content src/proxy.ts
git commit -m "feat(home): PUT /api/internal/home-content (puerta del CRM) + gate"
```

---

### Task 8: Home nueva (server-rendered desde config)

**Files:**
- Modify: `src/app/page.tsx` (reescritura)
- Modify: `src/components/HomeClient.tsx` (reescritura completa; pasa a server component)

- [ ] **Step 1: Reescribir `src/app/page.tsx`**

```tsx
import { HomeClient } from "@/components/HomeClient";
import { getCatalogo } from "@/lib/catalog";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { getContenidoHome } from "@/lib/home-datos";

// La oferta de cuotas y el contenido de home se leen de la DB en cada request:
// no pueden quedar congelados en el build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const contenido = await getContenidoHome();
  const [oferta, destacados] = await Promise.all([
    getOfertaCuotas(),
    getCatalogo({ limit: contenido.destacados.cantidad }),
  ]);
  return (
    <HomeClient oferta={oferta} contenido={contenido} destacados={destacados} />
  );
}
```

- [ ] **Step 2: Reescribir `src/components/HomeClient.tsx` (server component, sin `"use client"`)**

```tsx
import Link from "next/link";
import {
  Badge,
  ChipRow,
  Hero,
  Marquee,
  ProductCard,
  PromoBanner,
  RoomTiles,
  ServiceCard,
} from "@myd-org/ui";
import { AddToCartButton } from "@/components/AddToCartButton";
import { CuotasCard } from "@/components/CuotasCard";
import { mejorOpcionPara } from "@/lib/cuotas-exhibicion";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";
import type { Product } from "@/data/products";
import type { HomeContent, TileContent } from "@/data/home-defaults";

/* ── Icons (mismo criterio que el header: SVG inline, sin deps) ─── */

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" />
      <circle cx="7" cy="17.5" r="1.6" />
      <circle cx="17" cy="17.5" r="1.6" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
function CreditCardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
    </svg>
  );
}

const ICONOS_USP = [TruckIcon, CheckIcon, WhatsAppIcon];
const ICONOS_SERVICIO = [TruckIcon, CheckIcon, CreditCardIcon, ChatIcon];

/** El contrato de config (español) al shape del DS (inglés). */
function aTilesDS(items: TileContent[]) {
  return items.map((t) => ({
    eyebrow: t.eyebrow,
    title: t.titulo,
    imageSrc: t.imagen,
    href: t.href,
  }));
}

function TituloSeccion({
  titulo,
  acento,
  bajada,
  linkTodos,
}: {
  titulo: string;
  acento?: string;
  bajada?: string;
  linkTodos?: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-6 max-md:flex-col max-md:items-start">
      <div>
        <h2 className="font-display text-[clamp(30px,3.4vw,46px)] font-medium leading-[1.08] tracking-tight text-text">
          {titulo}
          {acento ? <em className="italic text-accent"> {acento}</em> : null}
        </h2>
        {bajada ? (
          <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted">{bajada}</p>
        ) : null}
      </div>
      {linkTodos ? (
        <a
          href={linkTodos}
          className="border-b-[1.5px] border-text pb-[3px] text-[13px] font-extrabold text-text transition-colors hover:border-accent hover:text-accent"
        >
          Ver todos →
        </a>
      ) : null}
    </div>
  );
}

/**
 * Home editorial. Server component: recibe oferta, contenido (DB mergeada con
 * defaults) y destacados desde el Server Component app/page.tsx.
 */
export function HomeClient({
  oferta,
  contenido,
  destacados,
}: {
  oferta: OfertaCuotas | null;
  contenido: HomeContent;
  destacados: Product[];
}) {
  const { anuncio, hero, marquee, ambientes, destacados: secDestacados, bannerDeco, decoGrid, servicios } = contenido;

  return (
    <>
      {/* Anuncio (contenido administrable) */}
      <div className="bg-primary px-4 py-2.5 text-center text-[12.5px] font-semibold tracking-wide text-on-primary">
        {anuncio.texto}
      </div>

      <main className="flex-1">
        <div className="mx-auto max-w-[1280px] px-[clamp(18px,4vw,48px)]">
          <div className="pt-[clamp(20px,3vw,36px)]">
            <Hero
              eyebrow={hero.eyebrow}
              title={hero.titulo}
              accent={hero.acento}
              lead={hero.bajada}
              imageSrc={hero.imagen}
              imageAlt={hero.imagenAlt}
              ctas={hero.ctas}
              usps={hero.usps.map((u, i) => {
                const Icon = ICONOS_USP[i % ICONOS_USP.length];
                return { label: u.label, icon: <Icon /> };
              })}
            />
          </div>

          <Marquee items={marquee.items} className="mt-[clamp(28px,4vw,48px)]" />

          {/* Ambientes */}
          <section className="pt-[clamp(56px,7vw,96px)]">
            <TituloSeccion titulo={ambientes.titulo} acento={ambientes.acento} bajada={ambientes.bajada} linkTodos={ambientes.linkTodos} />
            <RoomTiles items={aTilesDS(ambientes.items)} />
          </section>

          {/* Destacados */}
          <section className="pt-[clamp(56px,7vw,96px)]">
            <TituloSeccion titulo={secDestacados.titulo} acento={secDestacados.acento} bajada={secDestacados.bajada} linkTodos={secDestacados.linkTodos} />
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {destacados.map((p) => (
                <Link key={p.id} href={`/producto/${p.id}`}>
                  <ProductCard
                    variant="editorial"
                    name={p.name}
                    brand={p.brand}
                    price={p.precioFinal ?? p.price}
                    oldPrice={p.oldPrice}
                    badge={p.badgeText ? <Badge tone={p.badgeTone}>{p.badgeText}</Badge> : undefined}
                    image={<LightbulbIcon className="h-20 w-20 text-muted/30" />}
                    action={
                      <AddToCartButton
                        product={{ id: p.id, name: p.name, brand: p.brand, price: p.price }}
                      />
                    }
                    installments={<CuotasCard opcion={mejorOpcionPara(p.precioFinal, oferta)} />}
                  />
                </Link>
              ))}
            </div>
          </section>

          {/* Banner decorativo */}
          <PromoBanner
            className="mt-[clamp(56px,7vw,96px)]"
            eyebrow={bannerDeco.eyebrow}
            title={bannerDeco.titulo}
            accent={bannerDeco.acento}
            lead={bannerDeco.bajada}
            cta={bannerDeco.cta}
            imageSrc={bannerDeco.imagen}
          />

          {/* Deco grid + chips */}
          <section className="pt-[clamp(56px,7vw,96px)]">
            <TituloSeccion titulo={decoGrid.titulo} acento={decoGrid.acento} linkTodos={decoGrid.linkTodos} />
            <RoomTiles variant="grid" items={aTilesDS(decoGrid.items)} />
            <ChipRow chips={decoGrid.chips} className="mt-6" />
          </section>

          {/* Servicios */}
          <section className="grid grid-cols-1 gap-5 py-[clamp(56px,7vw,96px)] sm:grid-cols-2 lg:grid-cols-4">
            {servicios.items.map((s, i) => {
              const Icon = ICONOS_SERVICIO[i % ICONOS_SERVICIO.length];
              return <ServiceCard key={s.titulo} icon={<Icon />} title={s.titulo} text={s.texto} />;
            })}
          </section>

          {/* WhatsApp CTA (conversión, se preserva del diseño anterior) */}
          <section className="pb-[clamp(56px,7vw,96px)]">
            <div className="flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-[28px] bg-primary px-[clamp(24px,5vw,72px)] py-10 text-on-primary">
              <div className="flex items-center gap-5">
                <span className="[&_svg]:h-8 [&_svg]:w-8 [&_svg]:text-highlight">
                  <ChatIcon />
                </span>
                <div>
                  <p className="text-lg font-extrabold">¿Necesitás asesoramiento técnico?</p>
                  <p className="text-sm text-on-primary/70">
                    Escribinos por WhatsApp y te ayudamos a elegir el producto correcto.
                  </p>
                </div>
              </div>
              <a
                href="https://wa.me/5493757000000"
                className="shrink-0 rounded-full border-2 border-on-primary/60 px-6 py-2.5 text-sm font-bold transition-colors hover:bg-on-primary hover:text-primary"
              >
                Consultar ahora
              </a>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
```

Notas de comportamiento preservado del HomeClient viejo: `AddToCartButton` recibe `price: p.price` (neto, referencial — el carrito recalcula en el servidor), `mejorOpcionPara(p.precioFinal, oferta)` igual que antes, `Badge tone={p.badgeTone}`, la card entera linkea a la ficha (AddToCartButton ya hace preventDefault). El CTA de WhatsApp: reemplazar `5493757000000` por el número real del negocio antes de commitear (pedírselo a Fede si no está en ningún lado del repo).

- [ ] **Step 3: Verificar build + smoke**

Run: `npm run build` → compila. En dev: la home muestra anuncio, hero (placeholder crema), marquee, ambientes, destacados con cards editoriales y add-to-cart funcionando, banner, deco grid + chips, servicios, CTA. El footer es el global (no se monta acá).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/HomeClient.tsx
git commit -m "feat(home): home editorial renderizada desde config + defaults"
```

---

### Task 9: Catálogo — reskin editorial

**Files:**
- Modify: `src/components/CatalogoClient.tsx` (solo presentación)

- [ ] **Step 1: Card a variant editorial**

Localizar el render de `<ProductCard` dentro de la grilla y aplicar estos cambios (la lógica de estado, `hrefCon`, `startTransition`, paginación y facetas NO se toca):

```tsx
<ProductCard
  variant="editorial"
  name={p.name}
  brand={p.brand}
  price={p.precioExhibido}
  oldPrice={p.oldPrice}
  badge={p.badgeText ? <Badge tone={p.badgeTone}>{p.badgeText}</Badge> : undefined}
  image={<LightbulbIcon className="h-20 w-20 text-muted/30" />}
  action={<AddToCartButton product={{ id: p.id, name: p.name, brand: p.brand, price: p.price }} />}
  installments={<CuotasCard opcion={mejorOpcionPara(p.precioExhibido, oferta)} />}
/>
```

(El icono: reutilizar el mismo SVG de foco que el HomeClient o el que ya use el archivo; si el archivo no tiene un icono de placeholder, copiar `LightbulbIcon` de `src/components/HomeClient.tsx`.)

Si la card está envuelta en `<Link>` (como la home), mantener el wrapper. `precioExhibido = p.precioFinal ?? p.price` ya existe en el archivo — usarlo tal cual.

- [ ] **Step 2: Tipografía y contenedores**

- Título de la página / encabezado del catálogo: cambiar `font-extrabold` por `font-display text-[clamp(30px,3.4vw,46px)] font-medium tracking-tight text-text` (mantener el texto).
- Cada superficie de filtro/sidebar que tenga `bg-surface` + `rounded-*`: unificar a `rounded-[20px] border border-border/50 bg-surface`.
- Eliminar cualquier clase hardcodeada azul (`bg-[#1763d6]`, `text-[#454b54]`, gradientes `linear-gradient` con azules): reemplazar por utilidades semánticas (`bg-primary`, `text-muted`). Los `Chip variant="removable"` y `Select`/`Checkbox` del DS se re-pintan solos con los tokens — no cambiarlos.
- El contenedor de la grilla: asegurar `gap-5`.

- [ ] **Step 3: Verificar build + smoke**

Run: `npm run build` → compila. Smoke: filtros por categoría/marca siguen andando (estado en URL), paginación funciona, cards muestran precio serif + cuotas + "+" que agrega al carrito.

- [ ] **Step 4: Commit**

```bash
git add src/components/CatalogoClient.tsx
git commit -m "feat(catalogo): reskin editorial (cards, tipografia, superficies)"
```

---

### Task 10: Ficha de producto — reskin editorial

**Files:**
- Modify: `src/components/ProductoClient.tsx` (solo presentación)

- [ ] **Step 1: Eliminar imports muertos**

Quitar `PriceTier` del import de `@myd-org/ui` (importado sin uso). Mantener `Button` y `QuantityStepper`.

- [ ] **Step 2: Título y galería**

- Nombre del producto (h1): `font-display text-4xl font-medium tracking-tight text-text` (era `font-extrabold`).
- Galería/placeholder: el contenedor de la imagen pasa a `overflow-hidden rounded-[24px] bg-elevated` con el ícono/placeholder centrado (clases semánticas, sin azules hardcodeados).
- Breadcrumb: `text-muted` en los enlaces, hover `text-accent`.

- [ ] **Step 3: Card de precio (sacar el gradiente azul oscuro)**

Localizar el bloque del card de precio (es el que tiene el gradiente azul oscuro / `bg-surface-darker` y `CuotasLinea tono="oscuro"`). Reemplazar el contenedor por:

```tsx
<div className="rounded-[24px] border border-border bg-surface p-6">
  <PrecioConImpuestos price={producto.price} precioFinal={producto.precioFinal} />
  <CuotasLinea opcion={...} tono="claro" />
  {/* MediosDePagoModal y resto del contenido del card, igual */}
</div>
```

(`CuotasLinea` con `tono="claro"` porque el fondo ahora es claro; conservar los props de la opción de cuotas como están.)

- [ ] **Step 4: CTA y estado de stock**

- Botón de agregar al carrito (`Button`): quitar clases inline de gradiente/blue si las tuviera — el `Button` del DS con tokens editoriales ya sale tinta sobre crema.
- El mapa `ESTADO_STOCK` se conserva; solo ajustar colores hardcodeados a `text-success` / `text-warning` / `text-danger` (roles semánticos) si tuviera hex.

- [ ] **Step 5: Verificar build + smoke**

Run: `npm run build` → compila. Smoke: ficha muestra precio/stock en vivo (Alegra), cuotas, stepper de cantidad, agregar al carrito. El precio y stock que se le compromete al cliente siguen saliendo en vivo de Alegra (regla del doc de arquitectura).

- [ ] **Step 6: Commit**

```bash
git add src/components/ProductoClient.tsx
git commit -m "feat(ficha): reskin editorial (card de precio claro, titulo display)"
```

---

### Task 11: Carrito — reskin editorial

**Files:**
- Modify: `src/components/CarritoClient.tsx` (solo presentación)

- [ ] **Step 1: Superficies y tipografía**

- Encabezado "Tu carrito" (o similar): `font-display text-[clamp(30px,3.4vw,46px)] font-medium tracking-tight text-text`.
- Cada línea del carrito: contenedor `rounded-[20px] border border-border/50 bg-surface p-4` (o adaptar el existente a esa forma). Conservar `QuantityStepper max={linea?.stockDisponible ?? 999}` y el mensaje de `problema` en `text-danger`.
- Columna/box de resumen (subtotal/IVA/total): `rounded-[24px] border border-border bg-surface p-6`. Conservar `CuotasResumen` y el desglose "Precio sin impuestos".
- CTA "Continuar": `Button` del DS tal cual (tokens editoriales lo pintan). Seguir deshabilitado con `hayProblemas`.
- Estados `no_auth` y `error`: mismos textos y CTAs (`rutaIngreso("/carrito")`), solo superficie editorial.

- [ ] **Step 2: Verificar build + smoke**

Run: `npm run build` → compila. Smoke: agregar 2 productos desde la home, cambiar cantidades, ver que cotiza (useCotizacion), precio "(estimado)" mientras carga cotización, continuar al checkout habilitado.

- [ ] **Step 3: Commit**

```bash
git add src/components/CarritoClient.tsx
git commit -m "feat(carrito): reskin editorial"
```

---

### Task 12: Checkout — reskin editorial (lógica intacta)

**Files:**
- Modify: `src/components/CheckoutClient.tsx` (solo presentación)

**ADVERTENCIA:** este archivo concentra la lógica de pedido. Regla estricta: NO tocar estados, handlers, fetchs ni condiciones. Solo clases, markup de contenedores y el componente local `RadioCard`. Checklist de lo que debe quedar byte-a-byte igual: `claveIntento` (crypto.randomUUID), `fetch("/api/pedidos/pendiente")` al montar, `confirmar()` y su body `{ idempotencyKey, items, contactoNombre, contactoTelefono, entregaTipo, entregaCiudad, entregaDireccion, pagoMetodo, notas }`, manejo del 409 (recotizar), rama MP con `<PagoMercadoPago pedidoId numero monto emailComprador maxCuotas onPagado/>`, `cancelarYVolver`, `puedeConfirmar`, `CuotasResumen` con `resumenCuotas(total, oferta, { cuotasMax })`, limpieza del carrito solo en pago offline al confirmar o MP en `onPagado`.

- [ ] **Step 1: `RadioCard` local (reemplazo completo del componente local)**

```tsx
function RadioCard({
  seleccionado,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { seleccionado: boolean }) {
  return (
    <label
      className={
        seleccionado
          ? "block cursor-pointer rounded-[20px] border-[1.5px] border-accent bg-surface p-4 shadow-2"
          : "block cursor-pointer rounded-[20px] border border-border bg-surface p-4 transition-colors hover:border-accent"
      }
    >
      <input type="radio" className="sr-only" checked={seleccionado} {...props} />
      {/* el children original va acá, igual que antes */}
    </label>
  );
}
```

Adaptar al markup real del `RadioCard` local conservando sus children/estructura interna; lo único que cambia son las clases del contenedor (radio oculto + borde acentuado al seleccionar).

- [ ] **Step 2: Superficies y tipografía**

- Título del checkout: `font-display text-[clamp(30px,3.4vw,46px)] font-medium tracking-tight text-text`.
- Secciones (entrega, datos, pago): encabezados en `font-display text-2xl font-medium`; contenedores `rounded-[20px] border border-border/50 bg-surface p-5` (aplicar a los bloques que hoy tengan superficies distintas).
- `Field`/`Input` del DS: se re-pintan solos (ring con `--color-ring` ámbar) — no tocar.
- Panel lateral de totales (si existe): `rounded-[24px] border border-border bg-surface p-6`, con `CuotasResumen` intacto.
- Pantallas de confirmado/pagado: misma estructura, contenedor `rounded-[28px] border border-border bg-surface p-8 text-center`, íconos de éxito en `text-success`.

- [ ] **Step 3: Verificación de que la lógica no se tocó**

```bash
git diff main...HEAD -- src/components/CheckoutClient.tsx | grep -E '^[-+].*(useState|useRef|useEffect|fetch\(|confirmar|claveIntento|PagoMercadoPago|cancelarYVolver|puedeConfirmar|idempotencyKey)'
```

Expected: la lista de coincidencias muestra SOLO líneas de contexto cambiadas por el diff de clases. Cualquier línea que toque lógica (estados, fetchs, condiciones) debe revisarse a mano y revertirse. Además: `npm test` (tests de rutas de pedidos/pagos deben seguir verdes).

- [ ] **Step 4: Smoke de flujo completo**

En dev: carrito → checkout → elegir retiro → confirmar → pantalla de pedido confirmado con número. Con MP sandbox (credenciales del `.env.local`): aparece el brick, pagar con tarjeta de prueba (`APRO`), vuelve a la pantalla de pagado y el carrito se vació. Revisar que el pedido queda en `mi-cuenta`.

- [ ] **Step 5: Commit**

```bash
git add src/components/CheckoutClient.tsx
git commit -m "feat(checkout): reskin editorial sin tocar la logica de pedido"
```

---

### Task 13: Verificación end-to-end final

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Chequeos automáticos**

```bash
npm run lint && npm test && npm run build
```
Expected: todo verde.

- [ ] **Step 2: Smoke manual guiado (dev server, gate: usuario/clave del `.env.local`)**

1. Home: se ven anuncio, hero, marquee, ambientes, destacados (card editorial: marca small caps, precio serif, cuotas, "+"), banner, deco grid + chips, servicios, CTA WhatsApp, footer tinta.
2. El "+" de una card agrega al carrito y el count del header sube.
3. Nav: categorías reales linkean a `/catalogo?categoria=...`.
4. Catálogo: filtro por categoría + marca + búsqueda + orden; paginación; card editorial en grilla.
5. Ficha: precio/stock en vivo, stepper, agregar.
6. Carrito: cotización, cambio de cantidades, continuar.
7. Checkout: retiro/local, confirmar → número de pedido; MP sandbox con tarjeta de prueba.
8. `mi-cuenta`: chrome nuevo (header/footer), pedido listado.
9. Responsive: home y catálogo a 390px de ancho (grillas colapsan, nav scrollea).

- [ ] **Step 3: Smoke del contrato interno**

```bash
# escribir una sección
curl -s -X PUT localhost:3000/api/internal/home-content \
  -H "authorization: Bearer $SHOP_CRM_SECRET" -H 'content-type: application/json' \
  -d '{"key":"navBadge","payload":{"categoria":"<una categoría real>","texto":"Nuevo"}}'
```
Recargar: el item del nav lleva badge. Luego apagarlo:

```bash
curl -s -X PUT localhost:3000/api/internal/home-content \
  -H "authorization: Bearer $SHOP_CRM_SECRET" -H 'content-type: application/json' \
  -d '{"key":"navBadge","payload":null}'
```
Badge desaparece (default). Dejar `navBadge` en null al terminar.

- [ ] **Step 4: Commit final de ajustes (si hubo)**

```bash
git add -A && git commit -m "chore(redesign): ajustes finales de verificación" || echo "sin cambios"
```

---

### Task 14: Merge y deploy

- [ ] **Step 1: Merge a main**

```bash
git checkout main && git pull --rebase
git merge --no-ff rediseno-editorial -m "feat(redesign): rediseño editorial Central LED + home administrable"
git push origin main
```

- [ ] **Step 2: Deploy**

Vercel deploya `main` automáticamente. Verificar en producción (recordá que el gate sigue activo: entrar con usuario/clave).

- [ ] **Step 3: Avisar al lado CRM**

El contrato está listo para consumir: `PUT /api/internal/home-content` con Bearer `SHOP_CRM_SECRET` (documentado en `src/app/api/internal/home-content/route.ts` y las secciones en `src/data/home-defaults.ts`). El spec de la UI de administración se escribe en el repo del CRM como trabajo aparte.
