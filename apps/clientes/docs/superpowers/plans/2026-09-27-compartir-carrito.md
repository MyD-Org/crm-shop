# Compartir carrito por link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un cliente comparte su carrito con un link; quien lo abre ve una preview y lo carga (reemplazando o sumando).

**Architecture:** El link lleva `id:qty` en el query. Un módulo puro (`carrito-compartido.ts`) codifica, parsea y decide; la página server `/carrito/compartido` resuelve los productos del catálogo; un componente cliente aplica la decisión sobre el `CartContext`.

**Tech Stack:** Next 16 (App Router, cacheComponents), React 19, vitest, `@myd-org/ui`.

**Spec:** `apps/clientes/docs/superpowers/specs/2026-09-27-compartir-carrito-design.md`

## Global Constraints

- Textos visibles en **usted** (sin voseo ni tuteo); los archivos nuevos se suman a `carrito-checkout-sin-voseo.test.ts`.
- El link sólo transporta `id` (entero positivo, ≤ 64 chars) y `qty` (entero ≥ 1). Topes: `QTY_MAX = 9_999`, `MAX_LINEAS = 60`.
- Renderizar `/carrito/compartido` no modifica ningún carrito. `robots: noindex`.
- No se agrega nada a `RUTAS_PUBLICAS` del proxy.

## Review Focus

1. Link con basura / truncado por el chat (`?i=12:3,45:`) → se cargan los pares válidos, nunca error 500.
2. Receptor con carrito todavía no hidratado (`ready = false`) → botón deshabilitado, no se decide sobre un carrito vacío falso.
3. Producto inactivo o sin precio en el link → aparece como "no disponible" y no entra al carrito.
4. Doble toque en "Cargar" / "Sumar" → una sola mutación (no duplica cantidades).
5. Link enorme (cientos de pares) → se corta en `MAX_ENTRADAS_BODY` antes de procesar.

---

### Task 1: Módulo puro `carrito-compartido.ts`

**Files:**
- Create: `src/lib/carrito-compartido.ts`, `src/lib/carrito-compartido.test.ts`
- Modify: `src/lib/carrito-cliente.ts` (exportar `esIdValido`)

**Interfaces — Produces:**
- `codificarCompartido(items: readonly LineaCarrito[]): string`
- `parsearCompartido(raw: string | null | undefined): LineaCarrito[]`
- `hrefCompartido(items: readonly LineaCarrito[]): string` → `/carrito/compartido?i=...`
- `type AccionCompartido = "cargar" | "preguntar" | "igual"`
- `accionAlCompartir(actual, compartido): AccionCompartido`
- `separarDisponibles(items: CartItem[]): { disponibles: CartItem[]; noDisponibles: CartItem[] }`

- [ ] Tests: ida y vuelta; basura (`null`, `""`, `"a:b"`, `"1:-2"`, `"1:1.5"`, `"1:"`, id de 65 dígitos); duplicados suman; > 60 líneas recorta; > 200 pares se ignora el excedente; `accionAlCompartir` vacío / igual en otro orden / distinto; `separarDisponibles` con `faltante` y `price: 0`.
- [ ] Correr `npx vitest run src/lib/carrito-compartido.test.ts` → FAIL.
- [ ] Implementar.
- [ ] Correr → PASS. Commit.

### Task 2: `replaceItems` en `CartContext`

**Files:** Modify `src/context/CartContext.tsx`

**Interfaces — Produces:** `replaceItems(lista: { item: Omit<CartItem,"qty">; qty: number }[]): void` — una sola `mutar`, normaliza con `normalizarCarrito`, filtra `price <= 0`.

- [ ] Implementar y exponer en el contexto. `npx tsc --noEmit` limpio. Commit.

### Task 3: Botón "Compartir carrito" en `/carrito`

**Files:** Create `src/components/carrito/BotonCompartirCarrito.tsx`; Modify `src/components/CarritoClient.tsx` (junto al título).

**Interfaces — Consumes:** `hrefCompartido`, `compartirEnlace` (`src/lib/compartir.ts`).

- [ ] Botón outline con ícono; `compartirEnlace({ url: origin + hrefCompartido(items), titulo: "Le comparto mi carrito" })`; toasts de copiado/error iguales a `BotonCompartir`.
- [ ] Sumar el archivo a la guarda de voseo. Commit.

### Task 4: Página `/carrito/compartido`

**Files:**
- Create: `src/app/carrito/compartido/page.tsx`, `src/app/carrito/compartido/loading.tsx`, `src/lib/carrito-compartido-datos.ts` (server: `productosCompartidos(lineas)`), `src/components/carrito/CargarCompartido.tsx`
- Modify: `src/components/carrito-checkout-sin-voseo.test.ts`

**Interfaces — Consumes:** `parsearCompartido`, `separarDisponibles`, `accionAlCompartir`, `replaceItems`, `addItems`, `getProductosPorIds({ soloActivos: true, soloVisibles })`, `idPriceListCliente`, `identidadActual`, `catalogoSoloVisibles`.

- [ ] `productosCompartidos(lineas): Promise<{ item: CartItem; precioExhibido: number }[]>` — `CartItem` con `faltante` si no vino del catálogo.
- [ ] Página: vacío → "Este enlace no tiene productos"; lista de disponibles con foto, nombre, cantidad y precio; bloque de no disponibles; `CargarCompartido` con los disponibles. `generateMetadata` con `noindex`.
- [ ] `CargarCompartido`: botón deshabilitado sin `ready`; `accionAlCompartir` → cargar / igual / `Dialog` con Reemplazar, Sumar, Cancelar; guarda contra doble toque; navega a `/carrito`.
- [ ] Guarda de voseo con los archivos nuevos. Commit.

### Task 5: Verificación

- [ ] `npm test`, `npx tsc --noEmit`, `npm run lint`.
- [ ] Navegador: compartir desde `/carrito`, abrir el link con carrito vacío y con carrito lleno (las tres opciones), link basura.
