# Promociones en la home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sección "Promociones" editable en la home (producto estrella + hasta 6 ofertas, fechas, unidades, referencia de mercado, legales), con badge en las cards y bloque de promo en la ficha.

**Architecture:** Nueva clave `promociones` en `HomeContent` (una fila más de `shop.home_content`, sin migración). La lógica es pura y testeada en `src/lib/promociones/promo.ts`. La sección es un server component (como `TiendaOficialHome`) que lee los productos por SKU (caché del catálogo, sin relleno) y el stock de la sucursal de la promo (sin caché). Cards y ficha se enteran de la promo por un contexto cliente que se monta en el layout con datos chicos de `getContenidoHome()`. La vigencia se calcula fuera de caché: en el servidor con `connection()` para la sección, y en el cliente después del montaje para badges y ficha.

**Tech Stack:** Next.js (App Router + Cache Components; leer `node_modules/next/dist/docs/` antes de tocar caché), React, TypeScript, Drizzle, Vitest (`renderToStaticMarkup`), DS `@myd-org/ui`.

**Spec:** `apps/clientes/docs/superpowers/specs/2026-10-26-promociones-home-design.md`

## Global Constraints

- Todo comando se corre parado en `apps/clientes`. Verificación: `npm run lint`, `npx tsc --noEmit`, `npm test`.
- Todo texto de UI nuevo va en español formal de usted. `src/components/home/sin-voseo.test.ts` lo controla en `components/home`.
- Repo público: nada de URLs ni dominios de producción, ni datos reales. En tests y ejemplos, dominios `.example`. Nunca `git add -A` / `git add .`: agregar rutas explícitas.
- Zona horaria de fechas: `America/Argentina/Buenos_Aires` (UTC−03:00, sin horario de verano).
- Máximo **6** items. Defaults: `etiquetaBadge` = `"Precio de apertura"`, `etiquetaReferencia` = `"En otras tiendas desde"`.
- Legales por defecto (copia exacta): `"Promoción válida del {inicio} al {fin} o hasta agotar {unidades} unidades del producto estrella. Precios finales con IVA para pago por transferencia. Stock sujeto a disponibilidad."`
- Unidades: `quedan ≤ 2` (y > 0) → texto `"¡Últimas unidades!"`. Los números mostrados son siempre los reales: nada de totales inflados.
- Aviso en Modo edición con unidades agotadas (copia exacta): `"Quite el ajuste de precio del producto en Precios online del CRM."`
- Cualquier archivo nuevo con `'use cache'` se suma a `CON_CACHE` en `src/cache-guardas.test.ts`.
- La referencia de mercado **nunca** va en `oldPrice` (tachado). En la sección no se muestra el precio de lista.

## Review Focus

1. **Fin en hora local:** el admin carga "13/11 23:59" en un `datetime-local`. Eso tiene que guardarse como `2026-11-13T23:59:00-03:00`, no como UTC: si no, la promo termina 3 horas antes. Lo cubre el test de `aIsoArgentina` / `deIsoArgentina` (Task 1).
2. **Reposición o stock faltante:** si entra stock nuevo, el contador nunca muestra más que `unidadesPromo`. Si el producto no tiene fila en la sucursal de la promo, se toma stock 0 y se ve agotado, sin romper. Lo cubren los tests de `unidadesQuedan` (Task 1) y el render de la estrella agotada (Task 4).
3. **Referencia que no ahorra:** si `precioReferencia` es menor o igual al precio principal, no se muestran ni la línea ni el chip. Si falta `precioMedio`, el precio principal es el de lista. Lo cubren el test de `porcentajeAhorro` (Task 1) y el de `precioPrincipal` (Task 1).
4. **SKU ocultado o borrado después de armar la promo:** ese item no se dibuja. Si no queda nada visible, no hay sección, y en Modo edición se ve el aviso. Lo cubre el test de render "sin productos visibles" (Task 4).
5. **Hidratación:** badges, bloque de ficha y cuenta regresiva no pueden generar mismatch. Se dibujan recién después del montaje. Lo cubre el test de `usePromoProducto` con snapshot de servidor `null` (Task 6).

---

### Task 1: Lógica pura de la promo

**Files:**
- Create: `src/lib/promociones/promo.ts`
- Test: `src/lib/promociones/promo.test.ts`

**Interfaces:**
- Consumes: tipos `PromocionesContent`, `EstrellaPromo`, `ItemPromo` (los define la Task 2; para cortar la dependencia, esta task los declara en `src/lib/promociones/tipos.ts` y la Task 2 los re-exporta desde `home-defaults.ts`).
- Produces:
  - `type EstadoPromo = "inactiva" | "programada" | "vigente" | "terminada"`. "inactiva" = sin `fin` o sin productos.
  - `estadoPromo(p: Pick<PromocionesContent, "inicio" | "fin" | "estrella" | "items">, ahora: number): EstadoPromo`
  - `unidadesQuedan(e: Pick<EstrellaPromo, "unidadesPromo" | "stockBase">, stockActual: number | null): number | null`. `null` = sin contador.
  - `esUltimas(quedan: number | null): boolean`. Verdadero si `quedan` está entre 1 y 2.
  - `porcentajeAhorro(precio: number, referencia?: number): number | null`
  - `precioPrincipal(p: Pick<Product, "price" | "precioFinal" | "precioMedio">): { monto: number; esTransferencia: boolean }`
  - `skusPromo(p: Pick<PromocionesContent, "estrella" | "items">): string[]`. Normalizados con trim + mayúsculas, estrella primero, sin repetidos.
  - `aIsoArgentina(local: string): string` (`"2026-11-13T23:59"` → `"2026-11-13T23:59:00-03:00"`) y `deIsoArgentina(iso: string): string` (la inversa, para el input).
  - `fechaCortaAR(iso: string): string` → `"13/11"`.
  - `textoLegales(plantilla: string, datos: { inicio?: string; fin: string; unidades?: number }): string`. Sin `inicio` usa la fecha de hoy.
  - `restante(fin: string, ahora: number): { d: number; h: number; m: number; s: number } | null`. `null` = terminó.

- [ ] **Step 1: Write the failing tests** en `promo.test.ts`, una prueba por caso:
  - `estadoPromo`:
    - `{fin: "2026-11-13T23:59:00-03:00", items:[{sku:"A"}]}` da `"vigente"` con ahora = `Date.parse("2026-11-13T23:58:59-03:00")`.
    - Da `"terminada"` con ahora = `Date.parse("2026-11-13T23:59:00-03:00")`: el borde es exclusivo.
    - Con `inicio` futuro da `"programada"`.
    - Sin `fin`, o sin estrella ni items, da `"inactiva"`.
  - `unidadesQuedan({unidadesPromo:5, stockBase:10}, …)`:
    - stockActual 10 → 5; 8 → 3; 5 → 0; 3 → 0.
    - stockActual 14 (reposición) → 5.
    - stockActual `null` → 0.
    - Sin `unidadesPromo` → `null`.
  - `esUltimas`: 2 → true, 1 → true, 0 → false, 3 → false, `null` → false.
  - `porcentajeAhorro`: (109999, 150000) → 26 (redondeo hacia abajo); (150000, 150000) → null; (160000, 150000) → null; sin referencia → null.
  - `precioPrincipal`:
    - Con `precioMedio.precioFinal`, da ese monto y `esTransferencia: true`.
    - Sin `precioMedio`, da `precioFinal ?? price` y `false`. El builder usa el campo real de `PrecioMedio` en `src/data/products.ts`.
  - `skusPromo`: `{estrella:{sku:" nk-1 "}, items:[{sku:"NK-1"},{sku:"b"}]}` → `["NK-1","B"]`.
  - `aIsoArgentina("2026-11-13T23:59")` → `"2026-11-13T23:59:00-03:00"`. `deIsoArgentina` de ese resultado → `"2026-11-13T23:59"`. `deIsoArgentina("2026-11-14T02:59:00Z")` → `"2026-11-13T23:59"`.
  - `textoLegales` con la plantilla default, `{inicio:"2026-11-03T00:00:00-03:00", fin:"2026-11-13T23:59:00-03:00", unidades:5}` → `"Promoción válida del 3/11 al 13/11 o hasta agotar 5 unidades del producto estrella. Precios finales con IVA para pago por transferencia. Stock sujeto a disponibilidad."`
  - `restante`: a 1 día, 4 h, 12 min y 5 s del fin da `{d:1,h:4,m:12,s:5}`. Pasado el fin da `null`.
- [ ] **Step 2: Run** `npx vitest run src/lib/promociones/promo.test.ts`. Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implement** `src/lib/promociones/tipos.ts` (tipos de la spec §1 más `sucursal?: string` en `EstrellaPromo`) y `promo.ts`. El offset es fijo (`-03:00`): sin `Intl` para el cálculo y con `Intl.DateTimeFormat("es-AR", {timeZone})` solo para `fechaCortaAR`.
- [ ] **Step 4: Run** el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/promociones/ && git commit -m "feat(clientes): lógica pura de la promo de la home"`

### Task 2: El dato `promociones` en la home

**Files:**
- Modify: `src/data/home-defaults.ts` (tipos re-exportados de `lib/promociones/tipos.ts`, `HomeContent`, `SECCIONES_HOME` **al final**, `ORDEN_HOME` **después de `"hero"`**, `DEFAULTS_HOME`, `defaultsHomeGenerica()` con `visibilidad.promociones: "nunca"`, `case "promociones"` en `erroresSeccion`).
- Modify: `src/lib/home-editor.ts` (`TITULOS_SECCION.promociones = "Promociones"`; en `normalizarPayload`, items recortados a 6 y SKUs con trim).
- Modify (listas fijas de secciones): `src/data/home-defaults.test.ts`, `src/lib/home-acciones.test.ts`, `src/components/home-orden.test.tsx`.
- Test: `src/data/home-defaults.test.ts` (nuevo `describe("promociones")`), `src/data/defaults-marca.test.ts`, `src/lib/home-editor.test.ts`.

**Interfaces:**
- Consumes: Task 1 (`tipos.ts`; `videoEmbebible` de `src/lib/marcas/video.ts` para validar).
- Produces: `HomeContent["promociones"]: PromocionesContent`. Defaults de Central: `eyebrow: "Lanzamiento online"`, `titulo: "Precios de *apertura*"`, bajada de ejemplo, `items: []`, sin `fin`, etiquetas y `legales` default de Global Constraints.

- [ ] **Step 1: Write the failing tests** en `describe("promociones")`. `erroresSeccion("promociones", payload, hosts)` tiene que:
  - Aceptar el default.
  - Rechazar 7 items.
  - Rechazar un SKU repetido entre estrella e items.
  - Rechazar `precioReferencia: -1` y `1.5`.
  - Rechazar `video: "https://cdn.example/v.mp4"` y aceptar un link de YouTube.
  - Rechazar `unidadesPromo: 0`.
  - Rechazar `fin` ≤ `inicio`.
  - Rechazar items sin `fin`.
  - Rechazar `sucursal: "MDP!"` (slug inválido).

  Además, `ORDEN_HOME[1] === "promociones"`, y se actualizan las tres listas fijas de orden.
- [ ] **Step 2: Run** `npx vitest run src/data src/lib/home-editor.test.ts src/lib/home-acciones.test.ts src/components/home-orden.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** el `case` con los helpers existentes (`textosTitulo()`, `texto()`, `lista()`, `linkOpcional()`). Fechas: `Date.parse` válido, y si son `string`, con offset explícito.
- [ ] **Step 4: Run** el mismo comando más `npx tsc --noEmit`. Expected: PASS. Los errores de tipo de `EDITORES` y `HomeClient` (Records exhaustivos) se resuelven en las Tasks 4 y 5: si traban el typecheck, registrar placeholders `null`/`EditorDestacados` temporales en esta task y reemplazarlos después.
- [ ] **Step 5: Commit** con las rutas explícitas de los archivos tocados: `feat(clientes): sección promociones en el contenido de la home`.

### Task 3: Productos y stock de la promo

**Files:**
- Modify: `src/lib/catalogo-publico.ts` (nueva `productosPromo`).
- Create: `src/lib/promociones/stock.ts`.
- Modify: `src/lib/home-acciones.ts` (acciones para el editor).
- Test: `src/lib/catalogo-publico.test.ts`, `src/lib/promociones/stock.test.ts`, `src/lib/home-acciones.test.ts`.

**Interfaces:**
- Consumes: `getProductosPorSkus` (`src/lib/catalog.ts`), `elegirDestacados` (`src/lib/destacados.ts`), `leerDisponibilidadBruta` (`src/lib/stock-sucursal.ts`), `leerSucursalesYZonas` (`src/lib/sucursales-repo.ts`).
- Produces:
  - `productosPromo(args: { skus: string[]; soloVisibles: boolean; agrupar?: boolean; disp?: ContextoDisponibilidad; destacado?: MedioPrecio | null; cuotas?: MedioCuotas[] | null }): Promise<Product[]>`. Va cacheada `'use cache: remote'` con `TAG_CATALOGO` y perfil `catalogo`, con respaldo sin caché como `destacadosHome`. Devuelve **solo** los SKUs pedidos, en ese orden: los ordena con `elegirDestacados(pool, skus, skus.length)` y descarta el relleno.
  - `stockEnSucursal(ids: string[], sucursal: string): Promise<Record<string, number>>`. Sin caché. Calcula disponible = stock − reservado en esa sucursal, con piso 0. Un id sin fila da 0.
  - Server actions (solo admin, mismo guard que `resolverProductosHome`):
    - `stockParaPromo(sku: string, sucursal: string): Promise<{ id: string; stock: number } | null>`
    - `sucursalesParaPromo(): Promise<{ slug: string; nombre: string; predeterminada: boolean }[]>`

- [ ] **Step 1: Write the failing tests:**
  - `productosPromo` con un pool simulado de A, B, C, D y skus `["C","A"]` → `[C, A]`, sin B ni D.
  - Un SKU inexistente se omite.
  - `stockEnSucursal` con una bruta simulada `{stockPorSucursal:{"1":{mdp:10,igz:3}}, reservadoPorSucursal:{"1":{mdp:2}}}` → `{"1":8}`. Con un id sin fila → 0.
  - Las acciones devuelven 404/null a un usuario no admin, como las existentes.
- [ ] **Step 2: Run** `npx vitest run src/lib/catalogo-publico.test.ts src/lib/promociones src/lib/home-acciones.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Mirar la firma real de `StockPorSucursal` antes de indexar.
- [ ] **Step 4: Run** el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat(clientes): lectura de productos y stock de la promo`.

### Task 4: La sección en la home

**Files:**
- Create: `src/components/home/PromocionesHome.tsx` (server), `src/components/home/PromocionesVista.tsx` (client), `src/components/promociones/CuentaRegresiva.tsx` (client), `src/components/promociones/VideoPromo.tsx` (client, fachada).
- Modify: `src/app/page.tsx` (slot `promociones` dentro de `<Suspense fallback={null}>`) y `src/components/HomeClient.tsx` (prop + entrada en `secciones` con `<SeccionEditable seccion="promociones" …>`).
- Modify: los conteos de `<SeccionEditable` (de 9 a 10) en `src/app/home-editable.test.ts` y `src/components/home/seccion-editable.test.ts`.
- Test: `src/components/home/promociones-home.test.tsx`.

**Interfaces:**
- Consumes: Tasks 1 a 3. Para el patrón de flags y disponibilidad, copiar `TiendaOficialHome`: `connection()`, `flagsPublicos()`, `dispCatalogo()`. `videoEmbebible`.
- Produces:
  - `PromocionesVista(props: { contenido: PromocionesContent; estrella: { producto: Product; quedan: number | null } | null; items: Product[]; estado: EstadoPromo; edicion: boolean })`
  - `CuentaRegresiva(props: { fin: string; onFin?: () => void; compacta?: boolean })`. Formato `"Termina en 3 d 04 h 12 m"`; con segundos solo en las últimas 24 h.

- [ ] **Step 1: Write the failing tests** (render de `PromocionesVista` con `renderToStaticMarkup`):
  - Vigente con estrella y quedan 3 → contiene `"Quedan 3 de 5"`, `"En otras tiendas desde"`, `"−26 %"` y el botón "Agregar".
  - Quedan 2 → contiene `"¡Últimas unidades!"`.
  - Quedan 0 → contiene `"Agotadas las unidades a precio de apertura"` y no tiene botón "Agregar" (el enlace a la ficha sí está).
  - Estado `"terminada"` sin edición → markup vacío. En edición → contiene `"Terminó el"`.
  - `"programada"` en edición → contiene `"Programada: empieza el"`.
  - Sin estrella ni items → vacío fuera de edición.
  - Quedan 0 en edición → contiene la copia exacta del aviso del CRM.
  - El precio de lista no aparece en la estrella.
  - Los legales salen con las fechas reemplazadas.
- [ ] **Step 2: Run** `npx vitest run src/components/home src/app/home-editable.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - `PromocionesHome` calcula `estado` con `Date.now()` después de `await connection()`. Lee `productosPromo` y, si hay estrella con `unidadesPromo`, también `stockEnSucursal([estrella.id], sucursal ?? predeterminada)`.
  - Los items sin stock (`stock === "out"`) no se pasan a la vista.
  - Estrella sin stock en la sucursal de la promo → `quedan = 0`.
  - La vista reutiliza `TarjetaProductoCarrusel` para los items, con badge de promo y línea de referencia debajo.
  - Desktop: estrella grande más grilla. Mobile: estrella primero y items en 2 columnas.
  - `VideoPromo` muestra la foto con un botón de play y monta el iframe de `videoEmbebible` recién al tocarlo.
  - `CuentaRegresiva` cuenta con `setInterval` de 1 s, se dibuja recién después del montaje y llama a `onFin` en cero; la vista se oculta entonces.
  - Usar la skill `frontend-design` dentro del DS, con un acento de oferta.
- [ ] **Step 4: Run** el mismo comando más `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(clientes): sección de promociones en la home`.

### Task 5: Editor de la sección

**Files:**
- Create: `src/components/home/editores/EditorPromociones.tsx`.
- Modify: `src/components/home/editores/index.ts` (`EDITORES.promociones`).
- Test: `src/components/home/editores/editor-promociones.test.tsx`.

**Interfaces:**
- Consumes: `EditorProps<PromocionesContent>`, `CampoAcento`, `SelectorSkusDestacados` (uno con límite 1 para la estrella y otro con límite 6 para los items), Task 1 (`aIsoArgentina`/`deIsoArgentina`, `porcentajeAhorro`) y Task 3 (`stockParaPromo`, `sucursalesParaPromo`, `resolverProductosHome` para mostrar precios).
- Produces: un editor que emite un `PromocionesContent` válido para `erroresSeccion`.

- [ ] **Step 1: Write the failing tests** (render y funciones puras del editor):
  - `aplicarUnidades(contenido, { unidades: 5, stock: 10 })` deja `estrella.unidadesPromo = 5` y `stockBase = 10`.
  - Cambiar la estrella, la sucursal o las unidades vuelve a pedir el stock. Se prueba sobre el helper puro `necesitaStockBase(antes, despues)` → true o false.
  - El editor muestra, por producto, "por transferencia $X" y "−N %" cuando hay referencia.
  - Inputs de fecha `type="datetime-local"` con el valor en hora de Argentina.
- [ ] **Step 2: Run** `npx vitest run src/components/home/editores`. Expected: FAIL.
- [ ] **Step 3: Implement.** Campos de la spec §7, con textos en usted. Al guardar, `stockBase` ya tiene que estar en el payload.
- [ ] **Step 4: Run** el mismo comando más `src/components/home/sin-voseo.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(clientes): editor de la sección de promociones`.

### Task 6: Badge en cards y bloque de promo en la ficha

**Files:**
- Create: `src/components/promociones/PromoProvider.tsx` (client: contexto + `usePromoProducto`) y `src/components/promociones/PromoFicha.tsx` (client).
- Modify: `src/app/layout.tsx` (monta `PromoProvider` con `datosPromoCliente(contenido.promociones)` dentro de `Providers`).
- Modify: `src/components/TarjetaProductoCarrusel.tsx`, `src/components/catalogo/CatalogoProductos.tsx` y `src/components/favoritos/ProductoFavCard.tsx`: `badge={badgePromo ?? badgeProducto(p)}`.
- Modify: `src/app/producto/[id]/page.tsx` (si el SKU es la estrella con `unidadesPromo`, calcula `quedan` con `stockEnSucursal` y lo pasa como prop) y `src/components/ProductoClient.tsx` (`<PromoFicha>` debajo de `PrecioConImpuestos`).
- Test: `src/components/promociones/promo-provider.test.tsx` y `promo-ficha.test.tsx`.

**Interfaces:**
- Consumes: Task 1 (`estadoPromo`, `skusPromo`, `porcentajeAhorro`, `textoLegales`) y Task 4 (`CuentaRegresiva`).
- Produces:
  - `datosPromoCliente(p: PromocionesContent): DatosPromoCliente | null`. Puro, en `promo.ts`. Lleva solo `{inicio, fin, etiquetaBadge, etiquetaReferencia, legales, estrellaSku, unidadesPromo, refs: Record<skuNormalizado, number | undefined>}`.
  - `usePromoProducto(sku: string | undefined): InfoPromoProducto | null`. Usa `useSyncExternalStore` con snapshot de servidor `null`. Devuelve `{ etiquetaBadge, referencia?, fin, legales, esEstrella }` solo si la promo está vigente en el cliente.
  - `PromoFicha(props: { producto: Product; quedan?: number | null })`.

- [ ] **Step 1: Write the failing tests:**
  - `datosPromoCliente` de un contenido sin `fin` → `null`. Con datos → refs por SKU normalizado.
  - Render en servidor de una card con el provider vigente → **sin** badge (snapshot `null`: no hay mismatch).
  - `PromoFicha` con el hook simulado en vigente → contiene la etiqueta, `"En otras tiendas desde"`, `"Termina en"` y los legales. Con `quedan` 2 → `"¡Últimas unidades!"`. Sin promo → vacío.
  - Cruce solo por SKU exacto: un producto con nombre igual al SKU de la promo y SKU distinto no recibe badge.
- [ ] **Step 2: Run** `npx vitest run src/components/promociones`. Expected: FAIL.
- [ ] **Step 3: Implement.** La ficha toma el precio principal con `precioPrincipal` para el % de ahorro. No se toca `PrecioConImpuestos`.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` y `npm run lint`. Expected: todo PASS.
- [ ] **Step 5: Commit** `feat(clientes): badge y bloque de promo en cards y ficha`.

### Task 7: Verificación en navegador y PR

- [ ] **Step 1:** Levantar el dev server del Shop del worktree con `preview_start` (sumar una config en `owns/.claude/launch.json` si no existe, con un puerto libre). En Modo edición, cargar una promo de prueba:
  - estrella con un SKU con stock, `unidadesPromo` 5, `fin` dentro de 2 días, un video de YouTube;
  - dos items con referencia.
- [ ] **Step 2:** Verificar:
  - la sección después del hero, en desktop y en mobile (375 px);
  - la cuenta regresiva corriendo;
  - el video que carga recién al tocar;
  - el badge en el catálogo;
  - la ficha con el bloque de promo;
  - que no haya errores de consola ni de hidratación;
  - que con `fin` en el pasado la sección desaparezca.

  Captura de pantalla como prueba.
- [ ] **Step 3:** Push de la rama (`git push -u origin feat/promociones-home`) y PR contra `staging` con resumen, capturas y el pie de Claude Code.
