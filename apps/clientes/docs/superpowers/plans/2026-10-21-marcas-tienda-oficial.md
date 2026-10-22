# Páginas de marca y Tienda oficial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Páginas `/marcas` y `/marcas/[slug]` (nivel "oficial" para Led Premium, nivel "marca" para Macroled y Jadever), editables en el lugar por un admin, con bloque `tiendaOficial` en la home y "Marcas ▾" en el header.

**Architecture:** Cada página de marca es una fila `pagina-marca:<slug>` de `shop.home_content` (patrón de las institucionales), leída con `"use cache"` + `TAG_HOME`. Los productos salen del catálogo con dos filtros nuevos (`marcasPropias`, `linea`) que no dependen de `mostrar_marca` ni del stock. La edición reusa `ModoEdicion`, `ListaEditable`, `CampoImagen` y `SelectorSkusDestacados` con un diálogo propio por bloque. El desplegable del header se agrega en el DS (`SiteNavItem.menu`); el Shop manda `menu` siempre y con el DS viejo el ítem es un link a `/marcas`.

**Tech Stack:** Next.js 16 (App Router, Cache Components), React 19, Tailwind v4, `@myd-org/ui`, Drizzle (Postgres), Vitest.

**Spec:** `apps/clientes/docs/superpowers/specs/2026-10-20-marcas-tienda-oficial-design.md`

## Global Constraints

- Todo comando se corre parado en `apps/clientes`. Antes de escribir código de rutas, leer `node_modules/next/dist/docs/01-app` (params como `Promise`, `generateMetadata`, Cache Components).
- Texto de UI nuevo en **usted** (`CLAUDE.md`). El mensaje precargado de WhatsApp es voz del cliente.
- Repo público: nunca `git add -A` / `git add .`; sin dominios reales en código, tests ni docs (`.example`). `.github/scripts/repo-guard.sh tree` debe pasar.
- Nada específico de Central/Led Premium como dato de código: contenidos iniciales genéricos, parametrizados por el nombre de la marca.
- No pisar nombres de identidad de tienda: `Marca`, `getMarca`, `useMarca`, `TAG_MARCA`, `marca.ts`, `marca-base.ts`. El concepto nuevo es `PaginaMarca`, en `src/lib/marcas/`.
- Sin migraciones: todo en `shop.home_content` (ya acotada por tenant).
- Antes de cada commit: `git branch --show-current` debe dar `feat/marcas-tienda-oficial`.

## Review Focus

1. **Marca escrita distinto o `mostrar_marca = false`** → el producto igual aparece en la página de su marca (Task 3, test `marcasPropias ignora mostrar_marca`).
2. **Página no publicada o slug inexistente visitada por un cliente** → 404, y no aparece en `/marcas`, el menú, la home ni el sitemap (Tasks 2, 6, 8, 9, 10).
3. **Fila de `home_content` tocada a mano o vieja** (campos faltantes, tipos raros, HTML) → la página degrada a "no publicada" o descarta el campo, nunca rompe el render (Task 1, test `sanear degrada basura`).
4. **Marca sin stock** → la página muestra la línea completa y el total no cambia con el stock; el selector de valores del editor la sigue ofreciendo (Tasks 3, 6).
5. **Tienda genérica sin páginas de marca** → header igual que hoy (8 categorías), `tiendaOficial` oculto, `/marcas` 404 (Tasks 9, 10, 8).

---

### Task 1: Modelo `PaginaMarca` (módulo puro)

**Files:**
- Create: `src/lib/marcas/pagina-marca.ts`
- Test: `src/lib/marcas/pagina-marca.test.ts`

**Interfaces:**
- Produces:
  - `type NivelMarca = "oficial" | "marca"`
  - `type BloqueMarca = "hero" | "confianza" | "lineas" | "elegidos" | "componentes" | "obras" | "cotizacion" | "productos"`
  - `const BLOQUES_POR_NIVEL: Record<NivelMarca, readonly BloqueMarca[]>`: oficial = los 8 en ese orden; marca = `["hero", "lineas", "productos"]`.
  - Contenidos:
    - `HeroMarca { imagen?: string; imagenAlt?: string; sello?: string; cta?: string }`
    - `ConfianzaMarca { items: { valor: string; texto: string }[] }` (máx. 4)
    - `LineaMarca { slug: string; titulo: string; imagen?: string; categorias: string[]; skus: string[] }`
    - `LineasMarca { titulo?: string; items: LineaMarca[] }` (máx. 8)
    - `ElegidosMarca { titulo: string; skus: string[]; cantidad: number }` (1–12)
    - `ComponentesMarca { titulo: string; bajada?: string; chips: string[] }` (máx. 12)
    - `ObrasMarca { titulo: string; fotos: { imagen: string; alt: string; epigrafe?: string }[] }` (máx. 6)
    - `CotizacionMarca { titulo: string; bajada?: string; boton: string; mensaje: string }`
    - `ProductosMarca { titulo?: string }`
    - `ContenidoBloques`: un mapa del bloque a su tipo.
  - `PaginaMarca { slug: string; nombre: string; nivel: NivelMarca; publicada: boolean; orden: number; marcasCatalogo: string[]; logo?: string; bajada: string; acento?: string; seo?: { titulo?: string; descripcion?: string; imagenOg?: string }; bloques: Partial<ContenidoBloques>; visibilidad: Partial<Record<BloqueMarca, Visibilidad>> }`
  - `PREFIJO_CLAVE_MARCA = "pagina-marca:"` y `claveDeMarca(slug: string): string`.
  - `esSlugMarca(v: unknown): v is string` (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, ≤ 60) y `slugDeNombre(nombre: string): string` (sin tildes, minúsculas, guiones).
  - `sanearPaginaMarca(raw: unknown): PaginaMarca | null`: lectura estricta. `null` si falta slug/nombre/nivel válidos. Usa `textoPlano` de `institucional/paginas.ts` en todos los textos. Descarta ítems inválidos y bloques que no sean del nivel.
  - `validarPaginaMarca(raw: unknown, hosts: readonly string[]): string[]`: errores en usted. Imágenes con `motivoImagenInvalida`; `acento` es hex `#rrggbb` con contraste ≥ 4.5 contra `#0c0c0c` (reusar la función de contraste que usa `src/app/contraste-tokens.test.ts`; si no es exportable, moverla a `src/lib/contraste.ts`).
  - `validarBloqueMarca(bloque: BloqueMarca, payload: unknown, hosts: readonly string[]): string[]`
  - `contenidoInicial(nivel: NivelMarca, nombre: string): Partial<ContenidoBloques>`: textos genéricos.
    - Sello: "Tienda oficial · Vendedor oficial online".
    - CTA: "Ver los productos".
    - Componentes: "Lo que va adentro".
    - Obras: `Obras con ${nombre}`.
    - Cotización: título "¿Tiene una obra grande o un proyecto de arquitectura?", botón "Pedir cotización de obra", mensaje `Hola, quiero cotizar una obra con productos ${nombre}.`
    - Elegidos: "Los más elegidos", cantidad 8.
    - Confianza vacía.
  - `visibilidadBloque(p: PaginaMarca, b: BloqueMarca): Visibilidad`: default `"siempre"`, salvo `lineas` en nivel "marca" (`"nunca"`).
  - `ordenarPaginas(ps: PaginaMarca[]): PaginaMarca[]`: oficial primero, luego `orden`, luego `nombre`.
  - `itemsMenuMarcas(ps: PaginaMarca[]): ItemMenuMarca[]`: solo publicadas, ordenadas, más un "Ver todas las marcas" con `href: "/marcas"`. `ItemMenuMarca { label: string; href: string; destacado?: boolean; descripcion?: string }`.

- [ ] **Step 1: Write the failing tests** `pagina-marca.test.ts`:
  - `esSlugMarca` acepta `"led-premium"` y rechaza `"Led Premium"`, `"-x"` y uno de 61 caracteres.
  - `slugDeNombre("Led Prémium")` da `"led-premium"`.
  - `sanear degrada basura`: `sanearPaginaMarca(null)`, `({})` y `({slug:"x", nombre:"<b>", nivel:"otro"})` dan `null`. Con `bloques.hero.sello = "<script>x</script>Hola"` queda `"xHola"`. Un bloque `obras` en nivel "marca" se descarta.
  - `validarPaginaMarca` rechaza:
    - `marcasCatalogo: []`, con "Elija al menos un valor de marca del catálogo.".
    - `acento: "#222222"`, por contraste.
    - Un logo `http://` o de host ajeno.
  - `itemsMenuMarcas`: con [marca publicada orden 1, oficial publicada orden 5, marca no publicada] devuelve [oficial (`destacado: true`), marca, "Ver todas las marcas"]. Con [] devuelve [].
  - `contenidoInicial("oficial", "Acme").cotizacion.mensaje === "Hola, quiero cotizar una obra con productos Acme."`
- [ ] **Step 2:** `npx vitest run src/lib/marcas/pagina-marca.test.ts`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar `pagina-marca.ts` con las firmas de arriba.
- [ ] **Step 4:** El mismo comando. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(clientes): modelo PaginaMarca para páginas de marca`.

### Task 2: Lectura y guardado de páginas de marca

**Files:**
- Modify: `src/lib/home-guardar.ts` (agregar `leerSeccionesHomePorPrefijo`)
- Create: `src/lib/marcas/marcas-datos.ts`
- Test: `src/lib/marcas/marcas-datos.test.ts`, `src/lib/home-guardar.tenant.test.ts` (sumar caso)

**Interfaces:**
- Consumes: `sanearPaginaMarca`, `ordenarPaginas`, `PREFIJO_CLAVE_MARCA` (Task 1).
- Produces:
  - `leerSeccionesHomePorPrefijo(prefijo: string): Promise<Map<string, unknown>>`: `like` con el prefijo escapado (`%`, `_`, `\`), acotado por tenant.
  - `getPaginasMarca(): Promise<PaginaMarca[]>`: `"use cache"`, `cacheTag(TAG_HOME)`, `cacheLife("home")`. Si falla la base devuelve `[]` con `cacheLife("degradado")`. Ordenadas, incluye no publicadas.
  - `getPaginasMarcaPublicadas(): Promise<PaginaMarca[]>`
  - `getPaginaMarca(slug: string): Promise<PaginaMarca | null>`

- [ ] **Step 1:** Tests:
  - `home-guardar.tenant.test.ts`: `leerSeccionesHomePorPrefijo("pagina-marca:")` filtra por `tenant_id` y escapa `_` (assert sobre el SQL grabado, como los casos existentes).
  - `marcas-datos.test.ts` (mock de `home-guardar` y de `next/cache`): filas con una válida, una basura y una no publicada → `getPaginasMarca` devuelve 2 (la basura se descarta) y `getPaginasMarcaPublicadas` devuelve 1. `getPaginaMarca("no-existe")` es `null`.
- [ ] **Step 2:** `npx vitest run src/lib/marcas src/lib/home-guardar.tenant.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mismo comando. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(clientes): lectura de páginas de marca desde home_content`.

### Task 3: Catálogo: filtros por marca propia y por línea, y valores de marca

**Files:**
- Modify: `src/lib/catalog.ts` (`FiltrosCatalogo`, `marcaPropiaSql`, `condicionesDe`, nueva `getValoresMarca`)
- Modify: `src/lib/catalogo-publico.ts` (`ArgsDestacados.base?`, `valoresMarcaPublicos`)
- Test: `src/lib/catalog-marcas-propias.test.ts` (con `dbGrabadora`, como `catalog-texto.test.ts`)

**Interfaces:**
- Produces:
  - `FiltrosCatalogo.marcasPropias?: string[]`: valores crudos (`coalesce(nullif(brand,''), categoría Alegra)`, **sin** el `case` de `mostrar_marca`). Se aplica con `aplicar.marcas`.
  - `FiltrosCatalogo.linea?: { categorias: string[]; skus: string[] }`: unión de `filtroCategoriasSql(categorias)` y el match por código de `getProductosPorSkus` (`upper(btrim(code|name)) in (...)`). Se aplica con `aplicar.categorias`. Una línea vacía (las dos listas `[]`) no filtra.
  - `getValoresMarca(soloVisibles: boolean): Promise<{ valor: string; count: number }[]>`: tenant, activo, con precio, `soloVisiblesSql`, `enListado(false)`, **sin** stock ni zona, agrupado por `marcaPropiaSql`, sin vacíos, orden por `count desc`.
  - `ArgsDestacados.base?: FiltrosSinTexto`: si viene, reemplaza al pool `{ categorias: [CATEGORIA_DESTACADOS] }` en `leerDestacados`.

- [ ] **Step 1:** Tests:
  - `marcasPropias ignora mostrar_marca`: el SQL de `getPaginaCatalogo({filtros:{marcasPropias:["LED PREMIUM"]}})` contiene `coalesce(nullif(` y no contiene `mostrar_marca is false` dentro del `in`. Parámetros incluyen `"LED PREMIUM"`.
  - `linea une categorías y skus`: con `linea:{categorias:["Piscinas"], skus:["ab-1"]}` el SQL tiene un `or` con el subárbol y `upper(btrim(` y el parámetro `"AB-1"`.
  - Sin `soloStock` no aparece la condición de stock (`conStock`).
  - `getValoresMarca(true)` produce un `group by` sobre la marca propia, sin condición de stock.
- [ ] **Step 2:** `npx vitest run src/lib/catalog-marcas-propias.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar. Incluir `marcasPropias`/`linea` en la clave de caché: ya viajan en `filtros`, así que `filtrosCacheables` sigue `true`.
- [ ] **Step 4:** Mismo comando, más `npx vitest run src/lib/catalog` para no romper los existentes. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(clientes): filtros de catálogo por marca propia y línea`.

### Task 4: Acciones de servidor de marcas

**Files:**
- Create: `src/lib/marcas/marcas-acciones.ts` (`"use server"`)
- Test: `src/lib/marcas/marcas-acciones.test.ts` (patrón `home-acciones.test.ts`: mocks de `esAdmin`, `home-guardar`, `next/cache`)

**Interfaces:**
- Consumes: Task 1, Task 2 (`leerSeccionesHomePorPrefijo`), `getValoresMarca` (Task 3), `hostsDeMedios`.
- Produces (todas: `esAdmin()` primero, nunca lanzan, `updateTag(TAG_HOME)` al escribir):
  - `type ResultadoMarca = { ok: true } | { ok: false; errores: string[] }`
  - `crearPaginaMarca(datos: { nombre: string; slug: string; nivel: NivelMarca; marcasCatalogo: string[] }): Promise<ResultadoMarca>`: slug único por tenant, `orden` = max+1, `publicada: false`, `bloques: contenidoInicial(...)`.
  - `guardarDatosMarca(slug: string, datos: Pick<PaginaMarca, "nombre" | "nivel" | "marcasCatalogo" | "logo" | "bajada" | "acento" | "seo" | "publicada">): Promise<ResultadoMarca>`
  - `guardarBloqueMarca(slug: string, bloque: BloqueMarca, payload: unknown): Promise<ResultadoMarca>`
  - `cambiarVisibilidadBloqueMarca(slug: string, bloque: BloqueMarca, v: Visibilidad): Promise<ResultadoMarca>`
  - `moverPaginaMarca(slug: string, direccion: "arriba" | "abajo"): Promise<ResultadoMarca>`: intercambia `orden`.
  - `borrarPaginaMarca(slug: string): Promise<ResultadoMarca>`
  - `leerPaginasMarcaParaEditor(): Promise<{ ok: true; paginas: PaginaMarca[] } | { ok: false; error: string }>`: sin caché.
  - `leerPaginaMarcaParaEditar(slug: string)`, con la misma forma pero `pagina: PaginaMarca`.
  - `valoresMarcaParaEditor(): Promise<{ ok: true; valores: { valor: string; count: number }[] } | { ok: false; error: string }>`

- [ ] **Step 1:** Tests:
  - Sin admin, cada acción devuelve `{ok:false}` con "No tiene permiso para editar las marcas." y no escribe.
  - `crearPaginaMarca` con un slug existente da "Ya existe una página con esa dirección."
  - Un bloque ajeno al nivel da "Ese bloque no corresponde a esta página."
  - `guardarBloqueMarca` guarda la fila completa con el bloque reemplazado y llama `updateTag("home")`.
  - `moverPaginaMarca` intercambia el `orden` de las dos filas.
- [ ] **Step 2:** `npx vitest run src/lib/marcas/marcas-acciones.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mismo comando. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(clientes): acciones de servidor de páginas de marca`.

### Task 5: `/editar-marcas`

**Files:**
- Create: `src/app/editar-marcas/page.tsx`, `src/components/marcas/EditorMarcas.tsx`, `src/components/marcas/SelectorValoresMarca.tsx`
- Test: `src/app/editar-marcas/page.test.tsx` (patrón `editar-paginas/page.test.tsx`)

**Interfaces:**
- Consumes: acciones de la Task 4.
- Produces: `SelectorValoresMarca({ valores, elegidos, onChange })`: lista con casillas de los valores reales y su conteo. Los elegidos que no están en `valores` se muestran con la marca "sin productos". La reusa el diálogo de datos de la Task 7.

UI (usted): título "Páginas de marca" y una tabla/lista con nombre, nivel ("Tienda oficial" / "Marca"), estado ("Publicada" / "Oculta"), mover arriba/abajo, "Ver página" (`/marcas/<slug>`) y "Borrar" con confirmación. Debajo, el formulario "Nueva página" con nombre, dirección (autocompletada con `slugDeNombre` y editable), nivel y `SelectorValoresMarca`. `robots: { index: false, follow: false }`.

- [ ] **Step 1:** Test: para un no-admin la página llama `notFound()` (mismo mock que el test de editar-paginas).
- [ ] **Step 2:** `npx vitest run src/app/editar-marcas`. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mismo comando. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(clientes): editor de páginas de marca`.

### Task 6: `/marcas/[slug]`: render público

**Files:**
- Create: `src/app/marcas/[slug]/page.tsx`
- Create: `src/components/marcas/PaginaMarcaVista.tsx` (arma los bloques en orden con su visibilidad)
- Create: `src/components/marcas/bloques/` con `HeroMarca.tsx`, `ConfianzaMarca.tsx`, `LineasMarca.tsx`, `ElegidosMarca.tsx` (hueco por request, como `DestacadosHome`), `ComponentesMarca.tsx`, `ObrasMarca.tsx`, `CotizacionMarca.tsx`, `ProductosMarca.tsx` (hueco por request)
- Create: `src/lib/marcas/vista-marca.ts` (puro)
- Modify: `src/app/globals.css` (`[data-tema-marca="oficial"]`)
- Test: `src/lib/marcas/vista-marca.test.ts`

**Interfaces:**
- Consumes: `getPaginaMarca`, `getPaginasMarca` (Task 2); `marcasPropias`/`linea`, `destacadosHome({ base })` (Task 3); `paginaCatalogoPublica`; `CatalogoProductos`; `enlaceWhatsapp`; `getDatosFooter().whatsapp`.
- Produces (puro, en `vista-marca.ts`):
  - `metadataMarca(p: PaginaMarca, nombreTienda: string, conQuery: boolean): Metadata`
    - El título es `seo.titulo`, o si falta:
      - oficial: `${nombre} — Tienda oficial | ${nombreTienda}`
      - marca: `${nombre} | ${nombreTienda}`
    - La descripción es `seo.descripcion ?? bajada`.
    - OG: `seo.imagenOg ?? logo`.
    - `alternates.canonical: /marcas/<slug>`.
    - Con `conQuery`: `robots: { index: false, follow: true }`.
  - `filtrosDeMarca(p: PaginaMarca, lineaSlug?: string): FiltrosSinTexto`. Devuelve `{ marcasPropias: p.marcasCatalogo }`, más `linea` si `lineaSlug` coincide con una línea. No incluye `soloStock`.
  - `leerEstadoMarca(params: Record<string, string | string[] | undefined>, p: PaginaMarca): { linea?: string; pagina: number }`
  - `hrefLinea(slug: string, linea?: string): string`: `/marcas/<slug>?linea=<x>#productos`, o sin query.
  - `hrefCatalogoCompleto(p: PaginaMarca): string`: `/catalogo?marca=...` con los valores de `marcasCatalogo`.

Reglas de render:
- `notFound()` si la página no existe, o si no está publicada y el visitante no es admin. Esa comprobación de admin va en un hueco por request, igual que la home: la página publicada no calcula `esAdmin()`.
- Migas: Inicio › Marcas › {nombre}, con el `Breadcrumb` del DS.
- Nivel "oficial": todo el contenido va dentro de `<div data-tema-marca="oficial" style={{"--acento-marca": acento}}>`, que en `globals.css` pisa `--color-bg/surface/text/muted/accent` (fondo `#0c0c0c`/`#141418`, acento por defecto `#c0a15a`). El bloque Productos vuelve al tema de la tienda.
- Hero, nivel "oficial":
  - Imagen de fondo con velo (`linear-gradient` como el boceto).
  - Logo en caja blanca.
  - Sello en versalitas con borde de acento.
  - `<h1>` del nombre en `font-light`.
  - Botón "{cta} ({total})" a `#productos`.
- Hero, nivel "marca": fondo claro, logo, `<h1>` y bajada, sin sello.
- Productos:
  - `paginaCatalogoPublica({ filtros: filtrosDeMarca(...), orden: "destacados", pagina, soloVisibles, disp: await dispCatalogo(), destacado, cuotas })`.
  - Arriba, chips de líneas (`ChipRow`).
  - `CatalogoProductos` con `vista="grilla"`.
  - Paginación con links.
  - Link "Ver con todos los filtros →".
  - Título "{n} productos".
- Cotización: si `enlaceWhatsapp(footer.whatsapp, mensaje)` da `null`, el bloque no se dibuja.
- Elegidos: `destacadosHome({ skus, cantidad, base: filtrosDeMarca(p), ... })` dentro de `ProductosCarrusel`.

- [ ] **Step 1:** Tests de `vista-marca.ts`:
  - `metadataMarca` con oficial "Led Premium" y tienda "Central Led" da título "Led Premium — Tienda oficial | Central Led" y canonical `/marcas/led-premium`. Con `conQuery` es `noindex, follow`.
  - `filtrosDeMarca` no trae `soloStock`. Con una línea existente trae `linea`; con una desconocida, no.
  - `leerEstadoMarca({pagina:"0"})` da página 1; `{pagina:"3", linea:"piscinas"}` da `{pagina:3, linea:"piscinas"}` si existe la línea.
  - `hrefCatalogoCompleto` con `["LED PREMIUM","Led Premium"]` da `/catalogo?marca=LED+PREMIUM&marca=Led+Premium`.
- [ ] **Step 2:** `npx vitest run src/lib/marcas/vista-marca.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar `vista-marca.ts`, la página, los bloques y el CSS.
- [ ] **Step 4:** Tests en PASS, más `npx tsc --noEmit` sin errores.
- [ ] **Step 5:** Commit `feat(clientes): página pública de marca y tienda oficial`.

### Task 7: Edición en el lugar de la página de marca

**Files:**
- Create: `src/components/marcas/edicion/BloqueMarcaEditable.tsx` (como `SeccionEditable`, por `BloqueMarca`)
- Create: `src/components/marcas/edicion/DialogoBloqueMarca.tsx` (como `DialogoSeccion`, con `leerPaginaMarcaParaEditar` / `guardarBloqueMarca` / `cambiarVisibilidadBloqueMarca`)
- Create: `src/components/marcas/edicion/DialogoDatosMarca.tsx`. Edita nombre, bajada, logo, acento, SEO, valores de marca (`SelectorValoresMarca`) y "Publicada".
- Create: `src/components/marcas/edicion/BarraEdicionMarca.tsx`. Lleva el switch "Modo edición", "Datos de la página" y "Todas las marcas" (link a `/editar-marcas`).
- Create: `src/components/marcas/edicion/EdicionMarcaSiAdmin.tsx` (hueco server, monta `HabilitarEdicion` y la barra)
- Create: `src/components/marcas/edicion/editores.tsx`, con un editor por bloque:
  - Reusa `ListaEditable`, `CampoImagen` y `SelectorSkusDestacados`.
  - Las líneas editan `titulo`, `imagen`, `categorias` (texto separado por comas) y `skus` (`SelectorSkusDestacados`).
- Modify: `src/app/marcas/[slug]/page.tsx` (envolver con `ModoEdicionProvider` y los bloques con `BloqueMarcaEditable`)

**Interfaces:**
- Consumes: Task 4 y Task 6 (`PaginaMarcaVista`).
- Produces: `EDITORES_MARCA: Record<BloqueMarca, ComponentType<EditorProps<any>>>`.

- [ ] **Step 1:** Test `src/components/marcas/edicion/editores.test.ts`: `EDITORES_MARCA` cubre los 8 `BloqueMarca`.
- [ ] **Step 2:** `npx vitest run src/components/marcas`. Esperado: FAIL.
- [ ] **Step 3:** Implementar. Para un visitante, `BloqueMarcaEditable` aplica solo la visibilidad, con los mismos `ComoVisitante` y clases que la home. Exportar `ComoVisitante` desde `SeccionEditable.tsx` en vez de copiarlo.
- [ ] **Step 4:** Tests en PASS, más `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(clientes): edición en el lugar de páginas de marca`.

### Task 8: `/marcas` y sitemap

**Files:**
- Create: `src/app/marcas/page.tsx`
- Modify: `src/app/sitemap.ts`
- Test: `src/lib/seo.test.ts` (sumar caso, si existe; si no, `src/lib/marcas/sitemap-marcas.test.ts`)

**Interfaces:**
- Consumes: `getPaginasMarcaPublicadas`, `entradasSitemap(sitio, ids, paginasExtra)`.
- Produces: `rutasSitemapMarcas(ps: PaginaMarca[]): string[]` en `vista-marca.ts`. Da `[]` sin publicadas; si no, `["/marcas", ...ps.map(p => "/marcas/<slug>")]`.

`/marcas`:
- `notFound()` si no hay ninguna publicada.
- Grilla de logos: la oficial primero, en tarjeta oscura con su bajada; las demás en tarjetas claras.
- Título "Marcas".
- Metadata `Marcas | {tienda}`.

- [ ] **Step 1:** Test: `rutasSitemapMarcas([])` da `[]`. Con una publicada `led-premium` da `["/marcas","/marcas/led-premium"]`.
- [ ] **Step 2:** Correr el test. Esperado: FAIL.
- [ ] **Step 3:** Implementar la página y sumar `rutasSitemapMarcas(...)` a `paginasExtra` en `sitemap.ts`.
- [ ] **Step 4:** Test en PASS.
- [ ] **Step 5:** Commit `feat(clientes): índice de marcas y sitemap`.

### Task 9: Bloque `tiendaOficial` en la home

**Files:**
- Modify: `src/data/home-defaults.ts`:
  - Tipo `TiendaOficialContent { slug: string; titulo: string; cta: string; skus: string[] }`.
  - Sumarlo a `HomeContent` y a `SECCIONES_HOME`, después de `"destacados"`.
  - `DEFAULTS_HOME.tiendaOficial = { slug: "led-premium", titulo: "", cta: "Entrar a la tienda oficial", skus: [] }`.
  - En `defaultsHomeGenerica`, `slug: ""` y visibilidad `"nunca"`.
  - Agregar el `case` en `erroresSeccion` y en `combinarContenidoHome` si hace falta.
- Modify: `src/lib/home-editor.ts` (`TITULOS_SECCION.tiendaOficial = "Tienda oficial"`, `normalizarPayload`)
- Create: `src/components/home/editores/EditorTiendaOficial.tsx` (slug como `Select` de las páginas "oficial" vía `leerPaginasMarcaParaEditor`, título, CTA, `SelectorSkusDestacados`), registrado en `editores/index.ts`
- Create: `src/components/home/TiendaOficialHome.tsx` (hueco por request: `getPaginaMarca(slug)` publicada y oficial; si no, `null`; productos con `destacadosHome({ skus, cantidad: 3, base: filtrosDeMarca(p) })`)
- Modify: `src/components/HomeClient.tsx` (slot `tiendaOficial` después de destacados, con `SeccionEditable seccion="tiendaOficial"`), `src/app/page.tsx` (pasa el hueco en `Suspense`)
- Test: `src/data/home-defaults.test.ts` (sumar casos) o el test de defaults existente

- [ ] **Step 1:** Tests:
  - `erroresSeccion("tiendaOficial", {slug:"led-premium", titulo:"", cta:"x", skus:[]})` da `[]`.
  - Con `skus: "x"` da error.
  - `defaultsHomeGenerica(...).visibilidad.tiendaOficial === "nunca"`.
  - `SECCIONES_HOME.indexOf("tiendaOficial") === SECCIONES_HOME.indexOf("destacados") + 1`.
- [ ] **Step 2:** `npx vitest run src/data src/app/home-editable.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar. El bloque usa el diseño del boceto:
  - Fondo `#0c0c0c` (vía `data-tema-marca="oficial"`).
  - Izquierda: sello "Tienda oficial", logo, título y botón.
  - Derecha: 3 tarjetas `TarjetaProductoCarrusel`.
- [ ] **Step 4:** `npx vitest run` (unit completo). Esperado: PASS.
- [ ] **Step 5:** Commit `feat(clientes): bloque Tienda oficial en la home`.

### Task 10: "Marcas" en el header

**Files:**
- Modify: `src/lib/nav-badge.ts` (`maxCategoriasNav(conMarcas: boolean): number`, que da 7 con marcas y 8 sin)
- Modify: `src/components/HeaderServer.tsx`: `Header()` lee `getPaginasMarcaPublicadas()` (cacheado, catch → []) y pasa `menuMarcas: ItemMenuMarca[]`.
- Modify: `src/components/HeaderUI.tsx`: si `menuMarcas.length`, agrega `{ label: "Marcas", href: "/marcas", menu: menuMarcas }` al final y corta las categorías con `maxCategoriasNav(true)`. Tipa los ítems como `SiteNavItem & { menu?: ItemMenuMarca[] }`: con el DS 0.56 el campo se ignora y el ítem es un link.
- Modify: `src/components/home/editores/EditorNavBadge.tsx`. Usa `maxCategoriasNav(conMarcas)`, con `conMarcas` sacado de la misma acción que trae las categorías. Esa acción suma `conMarcas: boolean`.
- Test: `src/lib/nav-badge.test.ts`

- [ ] **Step 1:** Test: `maxCategoriasNav(true) === 7` y `maxCategoriasNav(false) === 8`.
- [ ] **Step 2:** Correr. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npx vitest run` y `npx tsc --noEmit`. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(clientes): ítem Marcas en el menú de la home`.

### Task 11: DS: `SiteNavItem.menu` (repo `MyD-Org/ui`)

**Files (en un worktree propio de `ui`, rama `feat/site-nav-menu`):**
- Modify: `src/components/SiteHeader.tsx`
- Test: `src/components/SiteHeader.test.tsx`
- Modify: `src/components/SiteHeader.stories.tsx`, `CHANGELOG`/versión según la convención del repo

**Interfaces:**
- Produces:
  - `SiteNavMenuItem { label: string; href: string; destacado?: boolean; descripcion?: string }`
  - `SiteNavItem.menu?: SiteNavMenuItem[]`
- Un ítem con `menu` no vacío es un disparador "{label} ▾" (`DropdownMenu` de Radix, con portal, `aria-haspopup`), en la fila del header completo y en la barra compacta. Las entradas son links por `renderLink`.
- `destacado`: fondo `bg-text` y texto `text-bg`, con la `descripcion` en `text-accent`. Solo tokens.

- [ ] **Step 1:** Tests:
  - Sin `menu`, el render es idéntico (snapshot o queries existentes).
  - Con `menu`, hay un `button` con `aria-haspopup="menu"` y el texto del label.
  - Al abrir (`userEvent`/`fireEvent`, según el patrón del repo) aparecen links con los `href`.
  - `destacado` lleva la clase `bg-text`.
- [ ] **Step 2:** `npm test -- SiteHeader`. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` y `npm run build` del DS. Esperado: PASS.
- [ ] **Step 5:** Commit en `ui`.
- Publicar y hacer el bump en el Shop es tarea de Emanuel (workflow Publish), no de este plan.
- Para verificar en local: `npm pack` del DS y extraer el tarball sobre `apps/clientes/node_modules/@myd-org/ui`. **No** se toca `package.json` ni el lockfile. Después, reiniciar el dev server.

### Task 12: Verificación final y servidor local

- [ ] `npx vitest run` (unit) y `npx tsc --noEmit` en PASS. `npx eslint src/lib/marcas src/components/marcas src/app/marcas src/app/editar-marcas` sin errores.
- [ ] `.github/scripts/repo-guard.sh tree` OK (desde la raíz del worktree).
- [ ] `.claude/launch.json` con `{ name: "shop-marcas", runtimeExecutable: "npm", runtimeArgs: ["run","dev","--","-p","3005"], port: 3005 }` desde `apps/clientes`. `.env.local` copiado (sin leerlo) desde el checkout principal. Levantar con `preview_start`.
- [ ] Verificar:
  - Home sin errores de consola.
  - `/marcas` da 404 sin páginas.
  - `/editar-marcas` da 404 sin sesión.
- [ ] Con una página publicada (la crea Emanuel desde `/editar-marcas`, o un script de siembra si Emanuel lo autoriza): `/marcas/led-premium` muestra los bloques, y "Marcas ▾" en la home y el bloque de la home aparecen.
