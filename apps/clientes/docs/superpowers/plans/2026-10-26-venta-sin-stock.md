# Venta sin stock por modalidad — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un producto sin stock disponible con una "modalidad de venta sin stock" activa se liste, muestre el texto de la modalidad en vez de "Sin stock" y se pueda comprar según su flujo (pago en línea normal, o pedido a confirmar sin cobro), con todo configurable desde el CRM y sin cambiar nada para los productos sin modalidad o con stock.

**Architecture:** El CRM suma la tabla `modalidades_sin_stock` y `catalog_overlay.modalidad_sin_stock_id` (0094); el Shop lee las modalidades ACTIVAS con una lectura aparte y tolerante (`modalidadesActivas()`, `[]` si la tabla falta) y sólo con una lista no vacía su SQL nombra la columna nueva (`= any('{…}'::uuid[])`, sin join a la tabla): con `[]` toda consulta es byte a byte la de hoy. La decisión "a pedido" de una línea es una sola: sin el flag `disponibilidad-sucursal`, stock < cantidad; con el flag, el motor (`origenDeLinea`) devuelve `por_pedido` donde hoy devuelve `sin_stock`, y las rutas le pasan esos ids a `cotizar` como entrada (`aPedido`), la misma regla que `crearPedido` re-aplica en la transacción. Una línea "a pedido" con flujo `a_confirmar` deja todo el pedido en `pago_metodo = "a_coordinar"`, cotizado con la lista del medio destacado, y cada línea "a pedido" guarda un snapshot en `order_items.venta_sin_stock` (0039 del Shop) que leen el mail, Mi cuenta y el CRM.

**Tech Stack:** Next.js 16 (App Router, Cache Components), React 19, Tailwind v4, `@myd-org/ui`, Drizzle (Postgres), Vitest (proyecto `unit`; `integration` contra Postgres local).

**Spec:** apps/clientes/docs/superpowers/specs/2026-10-26-venta-sin-stock-design.md

## Global Constraints

- Sin workspaces: cada comando se corre parado en `apps/clientes` o `apps/admin` (`npm test` = proyecto unit, `npx tsc --noEmit`, `npx eslint <archivos>`). NO correr `npm install` en ninguna app.
- Commits con rutas explícitas (`git add <ruta> …`); nunca `git add -A` / `git add .`; nunca `git push --force`. Antes de cada commit, `git branch --show-current` = `feat/venta-sin-stock`.
- Repo público: sin datos reales, marcas, proveedores ni plazos en código o tests (fixtures genéricos: "Modalidad 48 h", "A pedido"); dominios `.example`. `.github/scripts/repo-guard.sh tree` debe pasar.
- Nunca leer ni imprimir `.env*`.
- Texto de UI nuevo o modificado (admin, Shop, mails, `{error}` de API) en **usted**; botones en infinitivo. El copy existente del Shop no se reescribe.
- Nombre del concepto: **modalidad (de venta) sin stock**. "Etiqueta" ya son los tags del catálogo (`shop_tags`): no usarlo.
- Nombres compartidos (no renombrar): tabla `modalidades_sin_stock`, columna `catalog_overlay.modalidad_sin_stock_id`, columna `shop.order_items.venta_sin_stock`, tipos `VentaSinStock` / `ModalidadSinStock` / `SnapshotVentaSinStock`, campo `Product.ventaSinStock`, módulo puro `apps/clientes/src/lib/venta-sin-stock.ts`, lectura `apps/clientes/src/lib/venta-sin-stock-repo.ts`.
- Migraciones: CRM `0094_modalidades_sin_stock` (0089–0091 son de ramas abiertas; si `git log --all --oneline -- 'apps/admin/drizzle/0094*'` muestra algo, usar el siguiente libre y ajustar este plan); Shop `0039_order_items_venta_sin_stock`.
- Orden de despliegue: aplicar 0094 del CRM (a mano, desde esta rama) → aplicar 0039 del Shop (a mano: `db:migrate` no corre en el deploy) → recién ahí mergear/desplegar. Sin 0094 el Shop igual funciona (lectura tolerante); sin 0039, `crearPedido` y el detalle del pedido del CRM fallan, por eso va antes.
- **Sin feature flag.** El corte es el interruptor `activa` de cada modalidad; sin modalidades activas nada cambia.
- Un producto sin modalidad (o con modalidad inactiva) y uno con modalidad que TIENE stock se comportan exactamente como hoy en toda superficie (listado, card, ficha, carrito, cotización, pedido, mail, CRM).
- El servidor resuelve la modalidad y su flujo al cotizar y al crear el pedido; el navegador nunca decide "a pedido", el flujo ni la lista.
- El nombre interno de la modalidad (`nombre`) nunca viaja al navegador del comprador: `Product.ventaSinStock` y `LineaCotizada.ventaSinStock` llevan `VentaSinStock` (sin `nombre`); el `nombre` sólo existe en el CRM y en el snapshot del pedido.
- Next 16 / Cache Components: este cambio NO agrega funciones `'use cache'`; las modalidades se leen dentro de la capa del catálogo (precedente: la lectura del árbol de categorías) y quedan dentro de las entradas cacheadas existentes, que el aviso del CRM (`avisarShop` → `TAG_CATALOGO`) invalida. Si una tarea termina tocando caché, leer antes `apps/clientes/node_modules/next/dist/docs/` (guía de `use cache`).

## Review Focus

1. **Modalidad desactivada o borrada con el producto en un carrito** → la próxima cotización ya no la ve: la línea vuelve a `sin_stock` / `stock_insuficiente` y el pedido da 409 como hoy; si cambia entre la cotización y la transacción (o cambia su flujo), `crearPedido` tira `VentaSinStockCambioError` → 409 con la recotización; los pedidos ya creados conservan su snapshot y se siguen mostrando con su `texto` (Tasks 6, 12, 13, 14).
2. **Cantidad mayor al stock disponible (pero hay algo)** → la línea entera pasa a "a pedido" (no se parte), el tope del selector deja de ser el stock (999) en ficha, card y carrito; sin modalidad sigue `stock_insuficiente` ("Quedan N unidades") (Tasks 6, 9, 12).
3. **Carrito mixto: una línea `en_linea` + una `a_confirmar` + una con stock** → todo el pedido `a_coordinar`, sin paso de pago, sin cuotas ni forma, cotizado con la lista del medio destacado en TODAS las líneas (también las que tienen stock); con sólo líneas `en_linea` el checkout es el de siempre con todos sus medios (Tasks 12, 13, 14).
4. **Producto con stock en otra sucursal** → con traslado/respaldo habilitado manda lo de hoy ("a traer", "con demora"), no la modalidad; con traslado apagado y la sucursal elegida sin stock, `por_pedido`; la misma decisión en la ficha, el carrito y el pedido (motor → `aPedido` → `cotizar`; transacción → `porPedido`) (Tasks 11, 12, 13).
5. **CRM 0094 sin aplicar cuando despliega el Shop** → `leerModalidadesActivas` devuelve `[]` (con un `console.warn`) y el SQL del catálogo, la cotización y el motor es idéntico al de hoy; ningún 500 (Tasks 6, 8).

---

### Task 1: CRM — migración 0094 y esquema del admin

**Files:**
- Create: `apps/admin/drizzle/0094_modalidades_sin_stock.sql`, `apps/admin/drizzle/meta/0094_snapshot.json` (generado)
- Modify: `apps/admin/drizzle/meta/_journal.json`, `apps/admin/src/db/schema.ts` (junto a `reglasVenta` ~1186 y `catalogOverlay` ~732)
- Test: `apps/admin/test/integration/modalidades-sin-stock-0094.integration.test.ts` (patrón de `despacho-configurable-0093.integration.test.ts`)

**Interfaces:**
- Produces: tabla `modalidades_sin_stock (id uuid PK default gen_random_uuid(), tenant_id text NOT NULL → tenants(id), nombre text NOT NULL, texto text NOT NULL, plazo_dias integer NULL, flujo text NOT NULL, activa boolean NOT NULL DEFAULT true, created_at/updated_at timestamptz NOT NULL DEFAULT now())`, `UNIQUE (tenant_id, nombre)` (`modalidades_sin_stock_tenant_nombre_uniq`), CHECKs `plazo_dias IS NULL OR plazo_dias BETWEEN 1 AND 60`, `flujo IN ('en_linea','a_confirmar')`, `char_length(texto) BETWEEN 1 AND 40`; columna `catalog_overlay.modalidad_sin_stock_id uuid NULL REFERENCES modalidades_sin_stock(id) ON DELETE SET NULL`.
- Produces (drizzle): `export const modalidadesSinStock = pgTable("modalidades_sin_stock", …)` y `catalogOverlay.modalidadSinStockId: uuid("modalidad_sin_stock_id").references(() => modalidadesSinStock.id, { onDelete: "set null" })` (declarar la tabla ANTES de `catalogOverlay` o usar la función flecha en `references`).

- [ ] **Step 1: Verificar el número.** `git log --all --oneline -- 'apps/admin/drizzle/0094*'` sin resultados (si no, usar el siguiente libre).
- [ ] **Step 2: Test de integración que falla.**

```ts
describe("0094 modalidades_sin_stock", () => {
  it("crea la tabla con sus CHECK y el UNIQUE por tenant", async () => {
    await insertar({ nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazo_dias: 2, flujo: "en_linea" })
    await expect(insertar({ nombre: "Modalidad 48 h", texto: "Otro", plazo_dias: null, flujo: "a_confirmar" })).rejects.toThrow(/modalidades_sin_stock_tenant_nombre_uniq/)
    await expect(insertar({ nombre: "X", texto: "X", plazo_dias: 0, flujo: "en_linea" })).rejects.toThrow(/check/i)
    await expect(insertar({ nombre: "Y", texto: "Y", plazo_dias: null, flujo: "otro" })).rejects.toThrow(/check/i)
  })
  it("borrar la modalidad deja el overlay en NULL", async () => {
    // overlay con modalidad_sin_stock_id = id → DELETE de la modalidad → la columna queda NULL
    expect(filaOverlay.modalidad_sin_stock_id).toBeNull()
  })
})
```

- [ ] **Step 3: Correr.** `cd apps/admin && npm run test:integration -- modalidades-sin-stock-0094` → FAIL (relación inexistente). Sin Postgres local (`crm_test`) anotarlo y seguir: lo corre CI.
- [ ] **Step 4: Implementar.** SQL escrito a mano con la cabecera de la convención (propósito, GRANT, drift sólo en SQL, reversa), tomando 0045 (tabla + GRANT de tabla) y 0087 (GRANT por columna) como modelo. Un único bloque `DO $$ … IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN GRANT USAGE ON SCHEMA public TO shop_app; GRANT SELECT ON "public"."modalidades_sin_stock" TO shop_app; GRANT SELECT ("modalidad_sin_stock_id") ON "public"."catalog_overlay" TO shop_app; END IF; END $$;`. Reversa (en la cabecera): `REVOKE …; ALTER TABLE catalog_overlay DROP COLUMN modalidad_sin_stock_id; DROP TABLE modalidades_sin_stock;` sólo después de sacar la lectura del Shop. Drift sólo en SQL: los CHECK y el GRANT. Sumar la tabla y la columna a `schema.ts` con comentario (migración 0094, el Shop la lee con GRANT). Entrada en `_journal.json` y snapshot con `npx tsx scripts/drizzle-snapshot.ts`.
- [ ] **Step 5: Correr.** `cd apps/admin && npm run test:integration -- modalidades-sin-stock-0094` → PASS; `npm test -- snapshot-al-dia shop-schema-fuera-de-drizzle-kit` → PASS; `npx tsc --noEmit` → sin errores.
- [ ] **Step 6: Commit.** `git add apps/admin/drizzle/0094_modalidades_sin_stock.sql apps/admin/drizzle/meta/0094_snapshot.json apps/admin/drizzle/meta/_journal.json apps/admin/src/db/schema.ts apps/admin/test/integration/modalidades-sin-stock-0094.integration.test.ts && git commit -m "feat(admin): tabla modalidades_sin_stock y overlay.modalidad_sin_stock_id (0094)"`

---

### Task 2: CRM — validación, repo y API de modalidades

**Files:**
- Create: `apps/admin/src/lib/modalidades-sin-stock-validacion.ts`, `apps/admin/src/lib/modalidades-sin-stock-repo.ts`, `apps/admin/src/app/api/admin/modalidades-sin-stock/route.ts`, `apps/admin/src/app/api/admin/modalidades-sin-stock/[id]/route.ts`
- Test: `apps/admin/src/lib/modalidades-sin-stock-validacion.test.ts`, `apps/admin/src/app/api/admin/modalidades-sin-stock/route.test.ts` (patrón de `api/admin/despacho/route.test.ts`: repo simulado); repo en el integration test de Task 1 (sumar un `describe("repo")`)

**Interfaces:**
- Produces (validación, pura):
  - `type FlujoSinStock = "en_linea" | "a_confirmar"`
  - `interface ModalidadSinStock { id: string; nombre: string; texto: string; plazoDias: number | null; flujo: FlujoSinStock; activa: boolean }`
  - `type ModalidadEntrada = Omit<ModalidadSinStock, "id">`
  - `const MAX_NOMBRE = 60, MAX_TEXTO = 40, MIN_PLAZO = 1, MAX_PLAZO = 60`
  - `validarModalidad(body: unknown): { ok: true; modalidad: ModalidadEntrada } | { ok: false; campo: string; error: string }` (body `{ nombre, texto, plazoDias: number | string | null, flujo, activa }`; recorta espacios)
  - `avisoPlazoSinFecha(m: Pick<ModalidadEntrada, "plazoDias" | "flujo">): string | null`
  - `textoPlazo(plazoDias: number | null): string` → `"a coordinar" | "1 día hábil" | "N días hábiles"`
- Produces (repo; todo filtra por `tenantId` del guard):
  - `listarModalidades(tenantId): Promise<ModalidadSinStock[]>` (por `nombre`)
  - `crearModalidad(tenantId, body: unknown): Promise<ResultadoModalidad>`
  - `actualizarModalidad(tenantId, id: string, body: unknown): Promise<ResultadoModalidad>`
  - `borrarModalidad(tenantId, id: string): Promise<{ kind: "ok" } | { kind: "not_found" }>`
  - `modalidadPropia(tenantId, id: string): Promise<boolean>` (mismo rol que `categoriaPropia`)
  - `type ResultadoModalidad = { kind: "ok"; modalidad: ModalidadSinStock } | { kind: "invalid"; campo: string; error: string } | { kind: "not_found" }` (el 23505 de `modalidades_sin_stock_tenant_nombre_uniq` → `invalid` campo `nombre`)
- Produces (API, guard `requireAdminPlus`, `NO_STORE`): `GET /api/admin/modalidades-sin-stock` → `{ modalidades }`; `POST` → `{ ok, propagado, modalidad }` (201); `PUT /[id]` → `{ ok, propagado, modalidad }`; `DELETE /[id]` → `{ ok, propagado }`. 400 `{ error, code: "invalid", campo }`; 404 si el id no es de este tenant (o no es uuid). Toda escritura exitosa llama `avisarShop(tenantId)` (catálogo: cambia lo que se lista).

Textos exactos (usted):
- nombre: `"Ingrese un nombre de hasta 60 caracteres."`; duplicado: `"Ya existe una modalidad con ese nombre."`
- texto: `"Ingrese el texto para el comprador (hasta 40 caracteres)."`
- plazo: `"Ingrese un número entero de días hábiles entre 1 y 60, o elija «A coordinar»."`
- flujo: `"Seleccione el flujo de pago."`; activa: `"El valor indicado no es válido."`; body: `"Los datos indicados no son válidos."`
- aviso (sólo `plazoDias === null && flujo === "en_linea"`): `"El plazo queda a coordinar y el pago es en línea: el comprador pagará sin una fecha estimada."`

- [ ] **Step 1: Tests que fallan.**

```ts
describe("validarModalidad", () => {
  it("acepta una modalidad en línea con plazo", () => {
    expect(validarModalidad({ nombre: " Modalidad 48 h ", texto: "Retiro en ~48 h", plazoDias: "2", flujo: "en_linea", activa: true }))
      .toEqual({ ok: true, modalidad: { nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea", activa: true } })
  })
  it("plazo null = a coordinar", () => expect(validarModalidad({ ...base, plazoDias: null }).ok).toBe(true))
  it.each([0, 61, 2.5, "x"])("rechaza el plazo %s", (p) => expect(validarModalidad({ ...base, plazoDias: p })).toMatchObject({ ok: false, campo: "plazoDias" }))
  it("rechaza un texto de más de 40", () => expect(validarModalidad({ ...base, texto: "x".repeat(41) })).toMatchObject({ ok: false, campo: "texto" }))
  it("rechaza un flujo desconocido", () => expect(validarModalidad({ ...base, flujo: "gratis" })).toMatchObject({ ok: false, campo: "flujo" }))
  it("avisa a coordinar + en línea", () => {
    expect(avisoPlazoSinFecha({ plazoDias: null, flujo: "en_linea" })).toMatch(/sin una fecha estimada/)
    expect(avisoPlazoSinFecha({ plazoDias: null, flujo: "a_confirmar" })).toBeNull()
  })
  it("textoPlazo", () => expect([textoPlazo(null), textoPlazo(1), textoPlazo(5)]).toEqual(["a coordinar", "1 día hábil", "5 días hábiles"]))
})
// route.test.ts
it("sin sesión → 401 y sin aviso al Shop"); it("POST inválido → 400 con campo y sin aviso")
it("POST válido → 201, avisa al Shop del tenant del guard (no del body)"); it("DELETE de un id ajeno → 404 sin aviso")
```

- [ ] **Step 2: Correr.** `cd apps/admin && npx vitest run --project unit src/lib/modalidades-sin-stock-validacion.test.ts src/app/api/admin/modalidades-sin-stock` → FAIL (módulos inexistentes).
- [ ] **Step 3: Implementar** con la estructura de `despacho-validacion.ts` / `reglas-venta-repo.ts` / `api/admin/despacho/route.ts`; `updated_at = now()` en cada escritura; `borrarModalidad` borra la fila (el FK deja los overlays en NULL).
- [ ] **Step 4: Correr** el mismo comando → PASS; `npx tsc --noEmit`; `npx eslint` sobre los archivos nuevos.
- [ ] **Step 5: Commit.** `git add apps/admin/src/lib/modalidades-sin-stock-validacion.ts apps/admin/src/lib/modalidades-sin-stock-validacion.test.ts apps/admin/src/lib/modalidades-sin-stock-repo.ts apps/admin/src/app/api/admin/modalidades-sin-stock/route.ts apps/admin/src/app/api/admin/modalidades-sin-stock/route.test.ts "apps/admin/src/app/api/admin/modalidades-sin-stock/[id]/route.ts" apps/admin/test/integration/modalidades-sin-stock-0094.integration.test.ts && git commit -m "feat(admin): API de modalidades de venta sin stock"`

---

### Task 3: CRM — tarjeta "Venta sin stock" en Envíos

**Files:**
- Create: `apps/admin/src/components/admin/VentaSinStockCard.tsx`, `apps/admin/src/components/admin/venta-sin-stock-ui.ts` (lógica pura de la tarjeta)
- Modify: `apps/admin/src/app/admin/(protected)/envios/page.tsx` (después de `<DespachoCard />`; sumar "modalidades de venta sin stock" a la bajada)
- Test: `apps/admin/src/components/admin/venta-sin-stock-ui.test.ts`

**Interfaces:**
- Consumes: `ModalidadSinStock`, `validarModalidad`, `avisoPlazoSinFecha`, `textoPlazo` (Task 2); API de Task 2.
- Produces: `formDesdeModalidad(m?: ModalidadSinStock): FormModalidad`, `bodyDesdeForm(f: FormModalidad): unknown`, `resumenModalidad(m: ModalidadSinStock): string` (`"Retiro en ~48 h · 2 días hábiles · Pago en línea"`), `type FormModalidad = { nombre: string; texto: string; plazo: string; aCoordinar: boolean; flujo: FlujoSinStock; activa: boolean }`.

Copy (usted): título `"Venta sin stock"`; bajada `"Modalidades para vender productos sin stock disponible. Sólo se aplican cuando ninguna sucursal puede cubrir el producto."`; vacío `"Todavía no hay modalidades. Los productos sin stock se muestran «Sin stock» y no se pueden comprar."`; campos `"Nombre interno"`, `"Texto para el comprador"`, `"Plazo (días hábiles)"`, casilla `"A coordinar"`, `"Flujo de pago"` con opciones `"Pago en línea (como cualquier compra)"` / `"A confirmar (sin cobro; se coordina por contacto)"`, interruptor `"Activa"`; botones `"Agregar modalidad"`, `"Editar"`, `"Borrar"`, `"Guardar"`, `"Cancelar"`; confirmación de borrado `"¿Borrar la modalidad «{nombre}»? Los productos asignados quedarán sin modalidad."`; etiquetas de flujo en la lista `"Pago en línea"` / `"A confirmar"`; toast de guardado como `DespachoCard` (si `propagado` es false, el mismo aviso de "la tienda lo toma en su próximo ciclo").

- [ ] **Step 1: Test que falla.**

```ts
it("resumen con plazo y flujo", () =>
  expect(resumenModalidad({ id: "m1", nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea", activa: true }))
    .toBe("Retiro en ~48 h · 2 días hábiles · Pago en línea"))
it("a coordinar manda plazoDias null", () =>
  expect(bodyDesdeForm({ nombre: "A", texto: "A pedido", plazo: "7", aCoordinar: true, flujo: "a_confirmar", activa: true }))
    .toMatchObject({ plazoDias: null, flujo: "a_confirmar" }))
it("ida y vuelta form ↔ modalidad", () => expect(validarModalidad(bodyDesdeForm(formDesdeModalidad(m)))).toMatchObject({ ok: true }))
```

- [ ] **Step 2: Correr.** `cd apps/admin && npx vitest run --project unit src/components/admin/venta-sin-stock-ui.test.ts` → FAIL.
- [ ] **Step 3: Implementar** la tarjeta con el patrón de `DespachoCard` (fetch no-store, `Card`, `Field`, `Input`, `Switch`, `Select` de `@myd-org/ui`, errores por campo devueltos por la API); el interruptor "Activa" de cada fila hace `PUT` de la modalidad completa; el aviso `avisoPlazoSinFecha` se muestra en el formulario mientras aplique.
- [ ] **Step 4: Correr** → PASS; `npx tsc --noEmit`; `npx eslint` de los archivos tocados.
- [ ] **Step 5: Commit.** `git add apps/admin/src/components/admin/VentaSinStockCard.tsx apps/admin/src/components/admin/venta-sin-stock-ui.ts apps/admin/src/components/admin/venta-sin-stock-ui.test.ts "apps/admin/src/app/admin/(protected)/envios/page.tsx" && git commit -m "feat(admin): tarjeta Venta sin stock en Envíos"`

---

### Task 4: CRM catálogo — modalidad en el diálogo del producto

**Files:**
- Modify: `apps/admin/src/lib/catalogo-overlay.ts` (`CamposOverlayValidos` ~176, `validarCamposOverlay` ~266), `apps/admin/src/lib/catalogo-overlay-repo.ts` (`CamposOverlay` ~511, `guardarOverlay` ~529, `ProductoAdmin` ~1022, map ~1157, SELECT de `listarProductos` ~1202 y `detalleProducto`), `apps/admin/src/app/api/admin/catalogo/productos/[alegraId]/route.ts` (PATCH), `apps/admin/src/components/admin/catalogo/tipos.ts` (`ProductoDto`), `apps/admin/src/components/admin/catalogo/ProductoDialog.tsx`, `apps/admin/src/components/admin/catalogo/ProductosPanel.tsx` / `CatalogoShell.tsx` (cargar `GET /api/admin/modalidades-sin-stock` junto a categorías y tags y pasarlas al diálogo)
- Test: `apps/admin/src/lib/catalogo-overlay.test.ts`; `apps/admin/test/integration/catalogo-admin-productos.integration.test.ts` (un caso nuevo)

**Interfaces:**
- Consumes: `modalidadPropia` (Task 2).
- Produces: `CamposOverlayValidos.modalidadSinStockId?: string | null` (uuid o null; otro valor → campo `modalidadSinStockId`, `"Seleccione una modalidad válida."`); `CamposOverlay.modalidadSinStockId?: string | null`; `ProductoDto.modalidadSinStockId: string | null`; `opcionesModalidad(modalidades: ModalidadSinStock[]): { value: string; label: string }[]` (en `venta-sin-stock-ui.ts`: primero `{ value: "ninguna", label: "Ninguna" }`, las inactivas con sufijo `" (inactiva)"`).
- Decisión: el PATCH rechaza (400) una modalidad de otro tenant o inexistente con `modalidadPropia`, igual que la categoría. Variantes: el overlay se edita sobre el ancla (el PATCH ya rechaza variantes agrupadas), así el Shop lee la modalidad del ancla con `joinOverlay(true)`, el mismo criterio que `mostrar_marca`.

Copy: label `"Venta sin stock"`, ayuda `"Sólo se aplica cuando el producto no tiene stock disponible."`.

- [ ] **Step 1: Tests que fallan.**

```ts
it("modalidadSinStockId acepta un uuid y null", () => {
  expect(validarCamposOverlay({ modalidadSinStockId: UUID })).toEqual({ ok: true, value: { modalidadSinStockId: UUID } })
  expect(validarCamposOverlay({ modalidadSinStockId: null })).toEqual({ ok: true, value: { modalidadSinStockId: null } })
})
it("rechaza un id que no es uuid", () =>
  expect(validarCamposOverlay({ modalidadSinStockId: "x" })).toMatchObject({ ok: false, campo: "modalidadSinStockId" }))
it("opciones: Ninguna primero e inactivas marcadas", () =>
  expect(opcionesModalidad([activa, inactiva]).map((o) => o.label)).toEqual(["Ninguna", "Modalidad 48 h", "A pedido (inactiva)"]))
// integración: PATCH con una modalidad de otro tenant → 400; con una propia → el detalle trae modalidadSinStockId
```

- [ ] **Step 2: Correr.** `cd apps/admin && npx vitest run --project unit src/lib/catalogo-overlay.test.ts src/components/admin/venta-sin-stock-ui.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Validación + `guardarOverlay` (`set.modalidadSinStockId`) + DTO (`o.modalidad_sin_stock_id`) + select en el diálogo (manda `modalidadSinStockId` en el PATCH; `"ninguna"` → `null`).
- [ ] **Step 4: Correr** → PASS; `npm run test:integration -- catalogo-admin-productos` si hay base local; `npx tsc --noEmit`; eslint de los tocados.
- [ ] **Step 5: Commit.** `git add apps/admin/src/lib/catalogo-overlay.ts apps/admin/src/lib/catalogo-overlay.test.ts apps/admin/src/lib/catalogo-overlay-repo.ts "apps/admin/src/app/api/admin/catalogo/productos/[alegraId]/route.ts" apps/admin/src/components/admin/catalogo/tipos.ts apps/admin/src/components/admin/catalogo/ProductoDialog.tsx apps/admin/src/components/admin/catalogo/ProductosPanel.tsx apps/admin/src/components/admin/catalogo/CatalogoShell.tsx apps/admin/src/components/admin/venta-sin-stock-ui.ts apps/admin/src/components/admin/venta-sin-stock-ui.test.ts apps/admin/test/integration/catalogo-admin-productos.integration.test.ts && git commit -m "feat(admin): asignar modalidad sin stock desde el diálogo del producto"` (sólo los archivos que efectivamente cambiaron)

---

### Task 5: CRM catálogo — filtro por marca y acción masiva

**Files:**
- Modify: `apps/admin/src/lib/catalogo-overlay-repo.ts` (`FiltrosAdmin` ~347, `condicionesListado` ~405, `masivaOverlay` ~618), `apps/admin/src/lib/catalogo-admin.ts` (`parsearQueryListado` y la lista de claves de `parsearSeleccion` ~207), `apps/admin/src/app/api/admin/catalogo/productos/masiva/route.ts` (`ejecutar`), `apps/admin/src/components/admin/catalogo/ProductosPanel.tsx` (`CLAVES_FILTRO` ~98, select "Marca", acción masiva)
- Create: `apps/admin/src/app/api/admin/catalogo/marcas/route.ts` (GET → `{ marcas: MarcaDto[] }` reusando `listarMarcas` de `precios-online-repo.ts`, guard `requireAdminPlus`)
- Test: `apps/admin/src/lib/catalogo-admin.test.ts` (nuevo, puro: parseo), `apps/admin/test/integration/catalogo-admin-productos.integration.test.ts` (filtro y masiva)

**Interfaces:**
- Produces: `FiltrosAdmin.marca?: string` = la clave normalizada de `listarMarcas` (`lower(btrim(brand))`); condición `lower(btrim(p.brand)) = ${marca}`; query `?marca=` (1..100 caracteres; otro → 400 `"El filtro de marca es inválido"`, campo `marca`); la clave `"marca"` en las TRES listas (`parsearQueryListado`, `parsearSeleccion`, `CLAVES_FILTRO`).
- Produces: acción masiva `{ tipo: "modalidad", modalidadId: string | null }` → `masivaOverlay(tenantId, seleccion, { tipo: "modalidad"; modalidadId: string | null }, updatedBy)` con columna `modalidad_sin_stock_id` y valor `${id}::uuid` (mismo `INSERT … SELECT … ON CONFLICT` que categoría); id ajeno → `{ kind: "invalid", campo: "modalidadId", error: "Seleccione una modalidad válida." }` vía `modalidadPropia`.

Copy: filtro `"Marca"` con `"Todas las marcas"`; acción `"Asignar modalidad sin stock"` con select (`opcionesModalidad`, incluye `"Ninguna"`) y confirmación con el conteo de `/masiva/contar` como las demás.

- [ ] **Step 1: Tests que fallan.**

```ts
it("parsea ?marca= y la conserva en la selección por filtro", () => {
  const r = parsearQueryListado(new URL("http://interno/?marca=marca%20a"))
  expect(r).toMatchObject({ filtros: { marca: "marca a" } })
  expect(parsearSeleccion({ seleccion: { tipo: "filtro", filtros: { marca: "marca a" } } })).toMatchObject({ filtros: { marca: "marca a" } })
})
it("rechaza una marca vacía de más de 100", () => expect(parsearQueryListado(new URL(`http://interno/?marca=${"x".repeat(101)}`))).toBeInstanceOf(Response))
// integración: listado con marca → sólo esa marca (sin distinguir mayúsculas ni espacios);
// masiva modalidad por filtro de marca → afectados = productos de esa marca; modalidadId null limpia;
// modalidad de otro tenant → 400 y nada cambia
```

- [ ] **Step 2: Correr.** `cd apps/admin && npx vitest run --project unit src/lib/catalogo-admin.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Filtro + ruta de marcas + caso `"modalidad"` en `ejecutar` (validar `modalidadId` string o null) + UI del panel. La masiva ya llama `avisarShop`.
- [ ] **Step 4: Correr** → PASS; integración si hay base; `npx tsc --noEmit`; eslint.
- [ ] **Step 5: Commit.** `git add apps/admin/src/lib/catalogo-overlay-repo.ts apps/admin/src/lib/catalogo-admin.ts apps/admin/src/lib/catalogo-admin.test.ts apps/admin/src/app/api/admin/catalogo/productos/masiva/route.ts apps/admin/src/app/api/admin/catalogo/marcas/route.ts apps/admin/src/components/admin/catalogo/ProductosPanel.tsx apps/admin/test/integration/catalogo-admin-productos.integration.test.ts && git commit -m "feat(admin): filtro por marca y acción masiva de modalidad sin stock"`

---

### Task 6: Shop — módulo puro, lectura tolerante y contrato con el CRM

**Files:**
- Create: `apps/clientes/src/lib/venta-sin-stock.ts` (puro), `apps/clientes/src/lib/venta-sin-stock-repo.ts` (servidor)
- Modify: `apps/clientes/src/data/products.ts` (`Product.ventaSinStock?`), `apps/clientes/src/db/crm.ts` (tabla `crmModalidadesSinStock`; `crmOverlay.modalidadSinStockId`), `apps/clientes/src/db/__fixtures__/crm-contrato.json`, `apps/clientes/src/test/setup-flags.ts` (mock global del repo)
- Test: `apps/clientes/src/lib/venta-sin-stock.test.ts`, `apps/clientes/src/lib/venta-sin-stock-repo.test.ts` (con `vi.unmock`, patrón de `catalogo-atributos-disponibles.test.ts`), `apps/clientes/src/db/crm-contrato.test.ts` (ya existente: debe seguir pasando)

**Interfaces:**
- Produces (`venta-sin-stock.ts`, puro):
  - `type FlujoVentaSinStock = "en_linea" | "a_confirmar"`
  - `interface VentaSinStock { id: string; texto: string; plazoDias: number | null; flujo: FlujoVentaSinStock }` (lo que ve el navegador)
  - `interface ModalidadSinStock extends VentaSinStock { nombre: string }` (sólo servidor)
  - `interface SnapshotVentaSinStock { modalidadId: string; nombre: string; texto: string; plazoDias: number | null; flujo: FlujoVentaSinStock }`
  - `type FlujoPedido = "normal" | "a_confirmar"`
  - `esAPedido(p: Pick<Product, "stock" | "ventaSinStock">): boolean` = `stock === "out" && !!ventaSinStock`
  - `agotadoSinModalidad(p: Pick<Product, "stock" | "ventaSinStock">): boolean` = `stock === "out" && !ventaSinStock`
  - `aVentaSinStock(m: ModalidadSinStock): VentaSinStock` (quita `nombre`)
  - `modalidadPorId(modalidades: readonly VentaSinStock[], id: string | null | undefined): VentaSinStock | undefined`
  - `lineaAPedido(a: { stockDisponible: number | null; qty: number; modalidad?: VentaSinStock }): boolean` = modalidad && stock conocido && stock < qty
  - `flujoDelPedido(lineas: readonly { ventaSinStock?: Pick<VentaSinStock, "flujo"> }[]): FlujoPedido`
  - `snapshotLinea(m: ModalidadSinStock): SnapshotVentaSinStock`
  - `leerSnapshot(v: unknown): SnapshotVentaSinStock | null` (defensivo: jsonb de una fila vieja o rota → null)
  - `textoPlazoHabil(plazoDias: number | null): string` → `"a coordinar" | "1 día hábil" | "N días hábiles"`
  - `pedidoAConfirmarPorModalidad(pagoMetodo: string, items: readonly { ventaSinStock?: SnapshotVentaSinStock | null }[]): boolean` = `pagoMetodo === "a_coordinar"` y alguna línea con flujo `a_confirmar`
  - `class VentaSinStockCambioError extends Error { constructor(readonly ids: string[]) }`
  - Copy: `TEXTO_SE_CONFIRMA_POR_CONTACTO = "Se confirma por contacto; no se cobra al comprar"`, `TEXTO_CARRITO_A_CONFIRMAR = "Su pedido incluye productos que se confirman por contacto: no se cobra al comprar."`, `TEXTO_PEDIDO_A_CONFIRMAR = "Su pedido quedó a confirmar; no se realizó ningún cobro. Nos comunicaremos con usted para confirmarlo."`
- Produces (`venta-sin-stock-repo.ts`, SOLO servidor):
  - `leerModalidadesActivas(db?: Lector): Promise<ModalidadSinStock[]>` — `select … from crmModalidadesSinStock where tenant_id = shopTenantId() and activa`, sin caché; descarta filas inválidas (flujo desconocido, plazo fuera de 1..60); cualquier error (tabla o GRANT ausente) → `console.warn("[venta-sin-stock] …")` y `[]`. Nunca tira.
  - `modalidadesActivas = cache(async (): Promise<VentaSinStock[]> => (await leerModalidadesActivas()).map(aVentaSinStock))` (`cache` de React: una lectura por request; fuera de un render no memoriza).
- Produces (contrato): `crmModalidadesSinStock = publico.table("modalidades_sin_stock", { id, tenantId, nombre, texto, plazoDias, flujo, activa })`; `crmOverlay.modalidadSinStockId: uuid("modalidad_sin_stock_id")` con comentario "migración 0094 del CRM; sólo se nombra en SQL con modalidades activas (lectura tolerante)"; el fixture suma `public.modalidades_sin_stock` y `catalog_overlay.modalidad_sin_stock_id: uuid`.
- Produces (tests): en `setup-flags.ts`, `vi.mock("@/lib/venta-sin-stock-repo", () => ({ leerModalidadesActivas: vi.fn(async () => []), modalidadesActivas: vi.fn(async () => []) }))` con el comentario del patrón de `marca` (los tests que necesitan modalidades hacen `vi.mocked(modalidadesActivas).mockResolvedValue([...])`), y en el `beforeEach` existente de ese archivo (junto a `reiniciarFlags()`) los dos mocks vuelven a `[]` (`mockResolvedValue([])`), así un test "con modalidades" no contamina al siguiente.
- `Product` (data/products.ts): `ventaSinStock?: VentaSinStock` — presente sólo con modalidad ACTIVA; `stock` sigue siendo el real.

- [ ] **Step 1: Tests que fallan.**

```ts
const M: VentaSinStock = { id: "m1", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea" };
const C: VentaSinStock = { id: "m2", texto: "A pedido", plazoDias: null, flujo: "a_confirmar" };
it("a pedido sólo sin stock y con modalidad", () => {
  expect(esAPedido({ stock: "out", ventaSinStock: M })).toBe(true);
  expect(esAPedido({ stock: "low", ventaSinStock: M })).toBe(false);
  expect(agotadoSinModalidad({ stock: "out" })).toBe(true);
  expect(agotadoSinModalidad({ stock: "out", ventaSinStock: M })).toBe(false);
});
it("lineaAPedido: cantidad > stock pasa entera; sin modalidad nunca", () => {
  expect(lineaAPedido({ stockDisponible: 3, qty: 5, modalidad: M })).toBe(true);
  expect(lineaAPedido({ stockDisponible: 5, qty: 5, modalidad: M })).toBe(false);
  expect(lineaAPedido({ stockDisponible: 0, qty: 1 })).toBe(false);
  expect(lineaAPedido({ stockDisponible: null, qty: 9, modalidad: M })).toBe(false);
});
it("flujo: una línea a confirmar alcanza", () => {
  expect(flujoDelPedido([{ ventaSinStock: M }, {}])).toBe("normal");
  expect(flujoDelPedido([{ ventaSinStock: M }, { ventaSinStock: C }, {}])).toBe("a_confirmar");
});
it("snapshot y lectura defensiva", () => {
  const s = snapshotLinea({ ...C, nombre: "Interna" });
  expect(s).toEqual({ modalidadId: "m2", nombre: "Interna", texto: "A pedido", plazoDias: null, flujo: "a_confirmar" });
  expect(leerSnapshot(s)).toEqual(s);
  expect(leerSnapshot({ texto: 1 })).toBeNull();
  expect(leerSnapshot(null)).toBeNull();
});
it("pedido a confirmar sólo con a_coordinar y una línea a_confirmar", () => {
  expect(pedidoAConfirmarPorModalidad("a_coordinar", [{ ventaSinStock: s }])).toBe(true);
  expect(pedidoAConfirmarPorModalidad("a_coordinar", [{ ventaSinStock: null }])).toBe(false);
  expect(pedidoAConfirmarPorModalidad("transferencia", [{ ventaSinStock: s }])).toBe(false);
});
// venta-sin-stock-repo.test.ts (vi.unmock + dbGrabadora)
it("lee sólo las activas del tenant", …); it("tabla ausente → [] y console.warn, sin tirar", …);
it("descarta filas con flujo o plazo inválidos", …); it("modalidadesActivas no expone nombre", …)
```

- [ ] **Step 2: Correr.** `cd apps/clientes && npx vitest run --project unit src/lib/venta-sin-stock.test.ts src/lib/venta-sin-stock-repo.test.ts src/db/crm-contrato.test.ts` → FAIL.
- [ ] **Step 3: Implementar** los dos módulos, el contrato y el mock global.
- [ ] **Step 4: Correr** el mismo comando → PASS; `npm test` completo → PASS (el mock global deja el resto de los tests como estaban); `npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `git add apps/clientes/src/lib/venta-sin-stock.ts apps/clientes/src/lib/venta-sin-stock.test.ts apps/clientes/src/lib/venta-sin-stock-repo.ts apps/clientes/src/lib/venta-sin-stock-repo.test.ts apps/clientes/src/data/products.ts apps/clientes/src/db/crm.ts apps/clientes/src/db/__fixtures__/crm-contrato.json apps/clientes/src/test/setup-flags.ts && git commit -m "feat(clientes): modalidades de venta sin stock (módulo puro y lectura tolerante)"`

---

### Task 7: `order_items.venta_sin_stock` — migración 0039, espejo y detalle del pedido en el CRM

**Files:**
- Create: `apps/clientes/drizzle/0039_order_items_venta_sin_stock.sql` (+ `meta/0039_snapshot.json`, `_journal.json`)
- Modify: `apps/clientes/src/db/schema.ts` (`orderItems` ~732), `apps/admin/src/db/shop-schema.ts` (`shopOrderItems` ~154), `apps/admin/src/lib/pedidos-repo.ts` (`PedidoItemDto` ~1487, `toItemDto` ~1644), `apps/admin/src/components/admin/pedidos/PedidoDetalle.tsx` (~194, ~217, ~294)
- Create: `apps/admin/src/lib/pedido-venta-sin-stock.ts` (puro)
- Test: `apps/admin/src/lib/pedido-venta-sin-stock.test.ts`, `apps/admin/src/lib/pedidos-repo-dto.test.ts`

**Interfaces:**
- Consumes: `SnapshotVentaSinStock` (Task 6; en el admin se declara un tipo espejo `VentaSinStockLinea` con los mismos campos: las apps no comparten código).
- Produces (Shop): `orderItems.ventaSinStock: jsonb("venta_sin_stock").$type<SnapshotVentaSinStock | null>()` — NULL = línea normal. Migración generada con `npx drizzle-kit generate --name order_items_venta_sin_stock` y cabecera a mano (aditiva; "correr ANTES de desplegar: db:migrate no corre en el deploy"; reversa `ALTER TABLE "shop"."order_items" DROP COLUMN "venta_sin_stock"`).
- Produces (admin): `shopOrderItems.ventaSinStock: jsonb("venta_sin_stock").$type<VentaSinStockLinea | null>()`; `PedidoItemDto.ventaSinStock: VentaSinStockLinea | null` (con `leerVentaSinStock(v: unknown)` defensivo); `textoLineaAPedido(v: VentaSinStockLinea): string` = `"A pedido · {nombre} · {plazo}"` (plazo con `textoPlazo` de Task 2); `lineasFaltaStock(items: PedidoItemDto[]): PedidoItemDto[]` (las de hoy MENOS las que tienen `ventaSinStock`); `tituloAPedido(n: number): string` = `"1 producto a pedido"` / `"N productos a pedido"`.
- UI: bajo el nombre, como "A traer de…", `textoLineaAPedido` en `var(--amber)`; la alerta "Falta stock" usa `lineasFaltaStock`; si hay líneas a pedido, una `Alert tone="info"` con `tituloAPedido(n)` y por línea `"{name}: {texto}"`.

- [ ] **Step 1: Tests que fallan.**

```ts
const v = { modalidadId: "m1", nombre: "Modalidad 48 h", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea" as const };
it("texto de la línea", () => {
  expect(textoLineaAPedido(v)).toBe("A pedido · Modalidad 48 h · 2 días hábiles");
  expect(textoLineaAPedido({ ...v, plazoDias: null })).toBe("A pedido · Modalidad 48 h · a coordinar");
});
it("Falta stock no cuenta las líneas a pedido", () => {
  expect(lineasFaltaStock([item({ stockActual: 0, qty: 2, ventaSinStock: v }), item({ stockActual: 0, qty: 1, ventaSinStock: null })]).map((i) => i.id)).toEqual(["2"]);
});
it("título", () => expect([tituloAPedido(1), tituloAPedido(3)]).toEqual(["1 producto a pedido", "3 productos a pedido"]));
// pedidos-repo-dto.test.ts
it("toPedidoDetalleDto lleva el snapshot y null en una línea normal o con jsonb roto", …)
```

- [ ] **Step 2: Correr.** `cd apps/admin && npx vitest run --project unit src/lib/pedido-venta-sin-stock.test.ts src/lib/pedidos-repo-dto.test.ts` → FAIL.
- [ ] **Step 3: Implementar** migración del Shop (`cd apps/clientes && npx drizzle-kit generate --name order_items_venta_sin_stock`), espejo, DTO y UI.
- [ ] **Step 4: Correr** → PASS; `cd apps/clientes && npm test -- baseline migrate-destino` → PASS; `npx tsc --noEmit` en las dos apps.
- [ ] **Step 5: Commit.** `git add apps/clientes/drizzle/0039_order_items_venta_sin_stock.sql apps/clientes/drizzle/meta/0039_snapshot.json apps/clientes/drizzle/meta/_journal.json apps/clientes/src/db/schema.ts apps/admin/src/db/shop-schema.ts apps/admin/src/lib/pedidos-repo.ts apps/admin/src/lib/pedidos-repo-dto.test.ts apps/admin/src/lib/pedido-venta-sin-stock.ts apps/admin/src/lib/pedido-venta-sin-stock.test.ts apps/admin/src/components/admin/pedidos/PedidoDetalle.tsx && git commit -m "feat: snapshot de la modalidad sin stock en order_items (0039) y aviso en el pedido del CRM"`

---

### Task 8: Shop catálogo — SQL y mapeo ("Solo con stock", destacados, relacionados, autocompletado)

**Files:**
- Modify: `apps/clientes/src/lib/catalog.ts` (`FilaCatalogo` ~130, `mapFilaToProduct` ~184, `columnasCatalogo` ~336, `conStock` ~1238 y sus usos ~697/1517/1576, `piezasBusqueda` ~1507, `ordenDestacadosSql` ~1626, cada función exportada que consulta productos: `getCatalogo`, `getCategoriaExacta`, `getProductosPorIds`, `getProductosPorSkus`, `getVariantesDeGrupo`, `getPaginaCatalogo`, `contarCatalogo`, `getProducto`, `getFacetaCategorias`, `getFacetas`), `apps/clientes/src/lib/catalogo-publico.ts` (`relacionadosProducto` ~586)
- Test: `apps/clientes/src/lib/catalog-venta-sin-stock.test.ts` (nuevo, patrón de `catalog-overlay.test.ts` / `catalog-filtros.test.ts` con `dbGrabadora`), `apps/clientes/src/lib/catalogo-publico.test.ts`

**Interfaces:**
- Consumes: `modalidadesActivas`, `VentaSinStock`, `modalidadPorId`, `agotadoSinModalidad` (Task 6).
- Produces:
  - Cada función exportada lee `const modalidades = await modalidadesActivas()` UNA vez y la pasa a los constructores (no cambia ninguna firma pública).
  - `FilaCatalogo.overlayModalidadId?: string | null`; `columnasCatalogo(disp?, estructurados = false, agrupar = false, modalidades: readonly VentaSinStock[] = [])` suma `overlayModalidadId: crmOverlay.modalidadSinStockId` SÓLO con lista no vacía.
  - `mapFilaToProduct(fila, idPriceList?, hostsMedios?, baseMedios?, mediosPrecio?, modalidades: readonly VentaSinStock[] = [])` → `...(m ? { ventaSinStock: m } : {})` con `m = modalidadPorId(modalidades, fila.overlayModalidadId)`.
  - `conStock(disp?, modalidades: readonly VentaSinStock[] = [])` → con lista: `(stock is null or stock > 0 or ${aPedidoSql(modalidades)})`; sin lista: el SQL de hoy.
  - `aPedidoSql(modalidades)` (privada) = `${crmOverlay.modalidadSinStockId} = any(${literal(literalUuids(ids))}::uuid[])` — LITERAL, no parámetro: `ordenDestacadosSql` exige expresiones idénticas (ver su comentario).
  - `ordenDestacadosSql(ctx, disp?, modalidades = [])`: en el `escalon`, `nivelStock = 0` con `aPedidoSql` vale 1 (como stock corto), no 8.
- Decisiones: la modalidad sale del overlay del join (`joinOverlay(agrupar)`): con variantes, la del ancla (criterio de `mostrar_marca`). "Solo con stock" (`SOLO_STOCK_DEFAULT`) no cambia: `conStock` ya los cuenta, y por eso el autocompletado (`/api/shop/catalogo`, `soloStock`) y "Más de…" los incluyen sin otro cambio. `desempateRelevancia` no cambia (un producto a pedido queda después de los que tienen stock en una búsqueda). `relacionadosProducto` filtra `!agotadoSinModalidad(p)`.

- [ ] **Step 1: Tests que fallan.**

```ts
// ids de modalidad = uuid: `literalUuids` descarta en silencio lo que no lo es.
const U1 = "00000000-0000-4000-8000-000000000001";
const M = { id: U1, texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea" as const };
vi.mocked(modalidadesActivas).mockResolvedValue([]);  // default del mock global
it("sin modalidades activas el SQL es el de hoy (CRM 0094 sin aplicar)", async () => {
  const consultas = await grabar(() => getPaginaCatalogo({ soloVisibles: false, filtros: { soloStock: true } }));
  for (const c of consultas) expect(c.sql).not.toContain("modalidad_sin_stock_id");
});
it("con modalidades, 'Solo con stock' cuenta los a pedido", async () => {
  vi.mocked(modalidadesActivas).mockResolvedValue([M]);
  const [conteo, pagina] = sinLecturaDelArbol(await grabar(() => getPaginaCatalogo({ soloVisibles: false, filtros: { soloStock: true } })));
  for (const c of [conteo, pagina]) expect(c.sql).toContain(`"public"."catalog_overlay"."modalidad_sin_stock_id" = any('{${U1}}'::uuid[])`);  // crmOverlay es `publico.table`: va calificado
});
it("las facetas con stock y la búsqueda usan el mismo predicado", …);
it("orden destacados: a pedido pesa como stock corto (literal, sin parámetros nuevos)", …);
it("mapFilaToProduct: modalidad activa → ventaSinStock; id desconocido o sin lista → nada", () => {
  expect(mapFilaToProduct({ ...FILA, stock: "0", overlayModalidadId: U1 }, undefined, [], null, undefined, [M]))
    .toMatchObject({ stock: "out", ventaSinStock: M });
  expect(mapFilaToProduct({ ...FILA, stock: "0", overlayModalidadId: "otra" }, undefined, [], null, undefined, [M]).ventaSinStock).toBeUndefined();
  expect(mapFilaToProduct({ ...FILA, stock: "9", overlayModalidadId: U1 }, undefined, [], null, undefined, [M]))
    .toMatchObject({ stock: "in", ventaSinStock: M });   // con stock lleva la modalidad pero esAPedido es false
});
// catalogo-publico.test.ts
it("relacionados incluye a pedido y excluye agotados sin modalidad", …);
```

- [ ] **Step 2: Correr.** `cd apps/clientes && npx vitest run --project unit src/lib/catalog-venta-sin-stock.test.ts src/lib/catalogo-publico.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** → PASS; `npm test` completo (todos los `catalog*.test.ts` sin cambios → la caracterización de "sin modalidad no cambia"); `npx tsc --noEmit`; eslint de los tocados.
- [ ] **Step 5: Commit.** `git add apps/clientes/src/lib/catalog.ts apps/clientes/src/lib/catalog-venta-sin-stock.test.ts apps/clientes/src/lib/catalogo-publico.ts apps/clientes/src/lib/catalogo-publico.test.ts && git commit -m "feat(clientes): el catálogo lista y ordena los productos a pedido"`

---

### Task 9: Shop — cards, favoritos y variantes

**Files:**
- Modify: `apps/clientes/src/lib/catalogo-vista.ts` (`etiquetaStock` ~136, `maxCantidad` ~175, nueva `stockParaCard`), `apps/clientes/src/components/catalogo/CatalogoProductos.tsx` (~125, ~172), `apps/clientes/src/components/TarjetaProductoCarrusel.tsx` (~94), `apps/clientes/src/components/favoritos/ProductoFavCard.tsx` (~64, ~92), `apps/clientes/src/components/favoritos/FavoritosCompartidosLista.tsx` (~41), `apps/clientes/src/components/catalogo/PanelOpciones.tsx` (~45, ~114, ~215, ~313, ~323), `apps/clientes/src/lib/variantes-ficha.ts` (`opcionInicial` ~86)
- Test: `apps/clientes/src/lib/catalogo-vista.test.ts`, `apps/clientes/src/lib/variantes-ficha.test.ts`, `apps/clientes/src/components/catalogo/PanelOpciones.test.tsx`, `apps/clientes/src/components/catalogo/CatalogoProductos.variantes.test.tsx` (un caso)

**Interfaces:**
- Consumes: `esAPedido`, `agotadoSinModalidad` (Task 6).
- Produces: `stockParaCard(p: Pick<Product, "stock" | "ventaSinStock">): ProductStock` (a pedido → `"low"`; si no, `p.stock`); `etiquetaStock(p: Pick<Product, "stock" | "stockQty" | "ventaSinStock">)` → a pedido: `p.ventaSinStock.texto`; `maxCantidad(p: Pick<Product, "stock" | "stockQty" | "ventaSinStock">)` → con `ventaSinStock` (con o sin stock) `CANTIDAD_MAXIMA`; `topeCantidad(l: { stockDisponible: number | null; aceptaSinStock?: boolean }): number` (línea del carrito: con `aceptaSinStock` o stock null → `CANTIDAD_MAXIMA`; si no, el stock; vive acá junto a `maxCantidad`, no en `venta-sin-stock.ts`, para no crear un ciclo de imports); `opcionInicial<T extends { id: string; stock: ProductStock; ventaSinStock?: VentaSinStock }>` prefiere `!agotadoSinModalidad`.
- Decisión de tono: el DS no tiene tono neutro (`out` rojo, `low` ámbar, `in` verde): un producto a pedido pasa `stock="low"` (ámbar, el mismo tono "demora" de los textos de disponibilidad) con `stockLabel` = texto de la modalidad. Sin release del DS.
- Todas las superficies que hoy deshabilitan o rotulan con `stock === "out"` pasan a `agotadoSinModalidad(p)` (botón "Agregar al carrito", filtro de favoritos compartidos, "Sin stock" de la opción y su color `text-danger`); `textoDisponibilidad` de `PanelOpciones` devuelve el texto de la modalidad para una opción a pedido.

- [ ] **Step 1: Tests que fallan.**

```ts
const P = { stock: "out" as const, stockQty: 0, ventaSinStock: M };
it("card a pedido: texto de la modalidad en tono low", () => {
  expect(stockParaCard(P)).toBe("low");
  expect(etiquetaStock(P)).toBe("Retiro en ~48 h");
  expect(mostrarStockEnCard({ stock: "out" })).toBe(true);
});
it("sin modalidad, igual que hoy", () => {
  expect(stockParaCard({ stock: "out" })).toBe("out");
  expect(etiquetaStock({ stock: "out", stockQty: 0 })).toBeUndefined();
  expect(maxCantidad({ stock: "low", stockQty: 3 })).toBe(3);
});
it("con modalidad el tope no es el stock (cantidad > stock → a pedido)", () => {
  expect(maxCantidad({ stock: "low", stockQty: 3, ventaSinStock: M })).toBe(999);
  expect(topeCantidad({ stockDisponible: 3 })).toBe(3);
  expect(topeCantidad({ stockDisponible: 3, aceptaSinStock: true })).toBe(999);
});
it("opcionInicial: una opción a pedido es elegible", () =>
  expect(opcionInicial([{ id: "a", stock: "out" }, { id: "b", stock: "out", ventaSinStock: M }], "a")?.id).toBe("b"));
// PanelOpciones.test.tsx: opción a pedido → sin "Sin stock", muestra el texto y el botón habilitado
// CatalogoProductos: card a pedido → botón habilitado y "Retiro en ~48 h"; agotada sin modalidad → deshabilitada
```

- [ ] **Step 2: Correr.** `cd apps/clientes && npx vitest run --project unit src/lib/catalogo-vista.test.ts src/lib/variantes-ficha.test.ts src/components/catalogo` → FAIL.
- [ ] **Step 3: Implementar** (las cards pasan `stock={stockParaCard(p)}`).
- [ ] **Step 4: Correr** → PASS (incluida la guarda `components/catalogo/sin-literales.test.ts`); `npx tsc --noEmit`; eslint.
- [ ] **Step 5: Commit.** `git add apps/clientes/src/lib/catalogo-vista.ts apps/clientes/src/lib/catalogo-vista.test.ts apps/clientes/src/lib/variantes-ficha.ts apps/clientes/src/lib/variantes-ficha.test.ts apps/clientes/src/components/catalogo/CatalogoProductos.tsx apps/clientes/src/components/catalogo/CatalogoProductos.variantes.test.tsx apps/clientes/src/components/catalogo/PanelOpciones.tsx apps/clientes/src/components/catalogo/PanelOpciones.test.tsx apps/clientes/src/components/TarjetaProductoCarrusel.tsx apps/clientes/src/components/favoritos/ProductoFavCard.tsx apps/clientes/src/components/favoritos/FavoritosCompartidosLista.tsx && git commit -m "feat(clientes): cards y variantes muestran la modalidad en vez de Sin stock"`

---

### Task 10: Shop — ficha, JSON-LD y asistente

**Files:**
- Modify: `apps/clientes/src/components/ProductoClient.tsx` (`ESTADO_STOCK` ~60, `agotado` ~179, pill, `botonAgregar` ~214, cuotas ~366/394, opción ~340, `EntregaProducto` ~410), `apps/clientes/src/components/producto/EntregaProducto.tsx` (prop nueva), `apps/clientes/src/lib/producto-jsonld.ts` (~80), `apps/clientes/src/lib/chat-ia-productos.ts` (`ProductoAgente.stock` ~35, `aProductoAgente`, `aProductoResuelto` ~110)
- Create: `apps/clientes/src/lib/ficha-venta-sin-stock.ts` (pura: lo que decide la ficha)
- Test: `apps/clientes/src/lib/ficha-venta-sin-stock.test.ts`, `apps/clientes/src/lib/producto-jsonld.test.ts`, `apps/clientes/src/lib/chat-ia-productos.test.ts`, `apps/clientes/src/components/ProductoClient.variantes.test.tsx` (un caso)

**Interfaces:**
- Consumes: `esAPedido`, `agotadoSinModalidad`, `TEXTO_SE_CONFIRMA_POR_CONTACTO` (Task 6).
- Produces: `estadoFicha(p: Pick<Product, "stock" | "ventaSinStock">): { texto: string; tono: "ok" | "demora" | "no"; agotado: boolean; aConfirmar: boolean }` (a pedido → `{ texto: ventaSinStock.texto, tono: "demora", agotado: false, aConfirmar: flujo === "a_confirmar" }`; si no, lo de `ESTADO_STOCK` con `agotado = stock === "out"`, `aConfirmar = false`); `EntregaProducto` prop `aPedido?: string` (texto) que, sin `disponibilidad` (flag apagado), se muestra como ÚNICA línea de plazo (`ProductoClient` le pasa `esAPedido(producto) ? producto.ventaSinStock.texto : undefined`; con el flag, la línea sale del motor, Task 11); `ProductoAgente.stock: "disponible" | "pocas unidades" | "sin stock" | "a pedido"` y `ProductoAgente.entrega?: string` (texto de la modalidad).
- Ficha: pill con `estadoFicha` (`demora` = `bg-warning-soft text-warning`); botón "Agregar al carrito" habilitado (desktop y barra mobile) salvo `agotado`; con `aConfirmar` se ocultan `CuotasLinea`, "Hasta N cuotas", el modal y `CuotasConCarrito`, y bajo el botón va `TEXTO_SE_CONFIRMA_POR_CONTACTO`; la opción del selector usa `agotadoSinModalidad(o.producto)`.
- JSON-LD: `availability` = a pedido → `https://schema.org/BackOrder`; agotado → `OutOfStock`; si no `InStock`.
- Chat: a pedido → `stock: "a pedido"`, `entrega: texto`, y `available: !agotadoSinModalidad(p) && precio > 0`. `ProductoAgente` no está en un contrato de `platform` (sólo en el spec del asistente v1; `sales-cards/v1` no cambia), así que se amplía acá sin cambio de contrato.

- [ ] **Step 1: Tests que fallan.**

```ts
it("ficha a pedido en línea: texto, sin bloqueo, con cuotas", () =>
  expect(estadoFicha({ stock: "out", ventaSinStock: M })).toEqual({ texto: "Retiro en ~48 h", tono: "demora", agotado: false, aConfirmar: false }));
it("ficha a pedido a confirmar oculta cuotas", () => expect(estadoFicha({ stock: "out", ventaSinStock: C }).aConfirmar).toBe(true));
it("con stock y modalidad: lo de hoy", () => expect(estadoFicha({ stock: "in", ventaSinStock: C })).toEqual({ texto: "En stock", tono: "ok", agotado: false, aConfirmar: false }));
it("JSON-LD BackOrder", () => expect(jsonLd({ ...PRODUCTO, stock: "out", ventaSinStock: M }).offers.availability).toBe("https://schema.org/BackOrder"));
it("agente: a pedido y disponible", () => {
  expect(aProductoAgente({ ...PRODUCTO, stock: "out", ventaSinStock: M })).toMatchObject({ stock: "a pedido", entrega: "Retiro en ~48 h" });
  expect(aProductoResuelto({ ...PRODUCTO, stock: "out", ventaSinStock: M }).available).toBe(true);
  expect(aProductoResuelto({ ...PRODUCTO, stock: "out" }).available).toBe(false);
});
// ProductoClient: a confirmar → renderiza "Se confirma por contacto; no se cobra al comprar" y no "Sin stock"
```

- [ ] **Step 2: Correr.** `cd apps/clientes && npx vitest run --project unit src/lib/ficha-venta-sin-stock.test.ts src/lib/producto-jsonld.test.ts src/lib/chat-ia-productos.test.ts src/components/ProductoClient.variantes.test.tsx` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** → PASS; `npx tsc --noEmit`; eslint.
- [ ] **Step 5: Commit.** `git add apps/clientes/src/lib/ficha-venta-sin-stock.ts apps/clientes/src/lib/ficha-venta-sin-stock.test.ts apps/clientes/src/components/ProductoClient.tsx apps/clientes/src/components/ProductoClient.variantes.test.tsx apps/clientes/src/components/producto/EntregaProducto.tsx apps/clientes/src/lib/producto-jsonld.ts apps/clientes/src/lib/producto-jsonld.test.ts apps/clientes/src/lib/chat-ia-productos.ts apps/clientes/src/lib/chat-ia-productos.test.ts && git commit -m "feat(clientes): ficha, JSON-LD y asistente para productos a pedido"`

---

### Task 11: Shop — motor de disponibilidad `por_pedido` y sus textos

**Files:**
- Modify: `apps/clientes/src/lib/sucursales.ts` (`LineaEntrada` ~157, `OrigenLinea`, `origenDeLinea` ~240, `resolverLineas`), `apps/clientes/src/lib/sucursales-pedido.ts` (extraer `localDeRetiro` de `conLocalDeRetiro`), `apps/clientes/src/lib/sucursales-disponibilidad.ts` (estados, `EntradaDisponibilidad`, `disponibilidadPorSucursal`), `apps/clientes/src/lib/stock-sucursal.ts` (`DisponibilidadBruta`, `leerDisponibilidadBruta` ~169, `disponibilidadDe` ~248), `apps/clientes/src/lib/disponibilidad-vista.ts` (`disponibilidadParaMostrar`), `apps/clientes/src/lib/disponibilidad-textos.ts`, `apps/clientes/src/lib/venta-sin-stock.ts` (`idsAPedido`)
- Test: `apps/clientes/src/lib/sucursales.test.ts`, `apps/clientes/src/lib/sucursales-disponibilidad.test.ts`, `apps/clientes/src/lib/disponibilidad-textos.test.ts`, `apps/clientes/src/lib/stock-sucursal.test.ts`, `apps/clientes/src/lib/venta-sin-stock.test.ts`

**Interfaces:**
- Consumes: `VentaSinStock`, `modalidadesActivas`, `textoPlazoHabil` (Task 6).
- Produces:
  - `LineaEntrada.porPedido?: boolean`; `OrigenLinea = { origen: string; aTraer: boolean; porPedido?: true } | { error: "sin_stock" | "no_servible" }`. `origenDeLinea`: donde hoy devuelve `{ error: "sin_stock" }`, con `linea.porPedido` devuelve `{ origen: preferida, aTraer: false, porPedido: true }` (sólo si la preferida es candidata; `no_servible` y `sin_retiro` no cambian). Con cobertura (propia o por respaldo) el resultado es el de hoy.
  - `resolverLineas`: una línea `porPedido` no es `sin_stock` ni `aTraer` (origen = la sucursal del pedido ⇒ `aTraerDe` null). `ReglaAplicada` (jsonb `v: 1`) NO suma campos.
  - `localDeRetiro(entrada: EntradaAsignacion, datos: DatosSucursales): string | null` (exportada; `conLocalDeRetiro` la usa).
  - `EstadoEnvio = … | "por_pedido"`, `EstadoRetiro = … | "por_pedido"`; `EntradaDisponibilidad.modalidad?: Record<string, VentaSinStock>`; envío `por_pedido` → `{ estado: "por_pedido", origen: zona, demoraDias: plazoDias ?? 0, despachoDias }`; retiro → `{ estado: "por_pedido", desde: null, demoraDias: plazoDias ?? 0 }` (0 = "a coordinar", la convención de hoy). Las líneas por pedido NO entran en `lineasATraer`.
  - `DisponibilidadBruta.modalidad: Record<string, VentaSinStock>`; `leerDisponibilidadBruta(ids, sucursales, stockHeredado, db?, agrupar?, modalidades: readonly VentaSinStock[] = [])` suma `crmOverlay.modalidadSinStockId` al select de productos SÓLO con lista no vacía; `disponibilidadDe(…, datos & { modalidades?: readonly VentaSinStock[] })`; `disponibilidadParaMostrar` lee `modalidadesActivas()` y las pasa.
  - `idsAPedido(productos: Record<string, DisponibilidadProducto>, entrega: { tipo: "envio" | "retiro"; local: string | null }): Set<string>` (en `venta-sin-stock.ts`: envío → `envio.estado === "por_pedido"`; retiro → `retiro[local].estado === "por_pedido"`).
- Textos (`disponibilidad-textos.ts`, usted): retiro `por_pedido` → `"Retiro en {local}: disponible en {textoPlazoHabil(n)}"` / `"Retiro en {local}: a coordinar"`; `estadoRetiroLocal` → `"Disponible en 2 días hábiles"` / `"A coordinar"`; envío `por_pedido` → `"Envío a domicilio: despacho dentro de {plazo + despacho} días hábiles"` (con el despacho oculto: `"Envío a domicilio: disponible en N días hábiles"`; sin plazo: `"Envío a domicilio: a coordinar"`). Tono `demora`; peso como `a_traer`/`con_demora` (`pesoDemora`), así el resumen del carrito toma el peor plazo como hoy; `sinEntregaPosible` lo cuenta como entregable; la `aclaracion` "N productos se traen de otra sucursal" cuenta SÓLO `con_demora` (no `por_pedido`).

- [ ] **Step 1: Tests que fallan.**

```ts
// sucursales.test.ts — "stock en otra sucursal, traslado on/off"
const stock = fnStock({ igz: { p1: 0 }, mdp: { p1: 5 } });
it("con respaldo, manda el traslado aunque tenga modalidad", () =>
  expect(origenDeLinea({ id: "p1", qty: 1, ocultoEn: [], porPedido: true }, "igz", SUCS, stock, true)).toEqual({ origen: "mdp", aTraer: true }));
it("sin respaldo y sin stock en la elegida: por pedido", () =>
  expect(origenDeLinea({ id: "p1", qty: 1, ocultoEn: [], porPedido: true }, "igz", SUCS, stock, false)).toEqual({ origen: "igz", aTraer: false, porPedido: true }));
it("sin modalidad, sin_stock como hoy", () =>
  expect(origenDeLinea({ id: "p1", qty: 1, ocultoEn: [] }, "igz", SUCS, stock, false)).toEqual({ error: "sin_stock" }));
it("asignarSucursal: la línea por pedido sale de la sucursal del pedido y no es 'a traer'", …);
// sucursales-disponibilidad.test.ts
it("envío sin stock con modalidad → por_pedido con el plazo (null → 0)", () => {
  const r = disponibilidadPorSucursal({ ...ENTRADA, modalidad: { p1: { ...M, plazoDias: null } } });
  expect(r.productos.p1.envio).toMatchObject({ estado: "por_pedido", demoraDias: 0 });
  expect(r.lineasATraer).toEqual([]);
});
it("sin modalidad: sin_stock, igual que hoy", …);
// disponibilidad-textos.test.ts
it("textos por_pedido", () => {
  expect(textoRetiro("Centro", { estado: "por_pedido", desde: null, demoraDias: 2 })).toBe("Retiro en Centro: disponible en 2 días hábiles");
  expect(textoEnvio({ estado: "por_pedido", origen: "igz", demoraDias: 2, despachoDias: 1 })).toBe("Envío a domicilio: despacho dentro de 3 días hábiles");
  expect(textoEnvio({ estado: "por_pedido", origen: "igz", demoraDias: 0, despachoDias: 1 })).toBe("Envío a domicilio: a coordinar");
});
it("la aclaración no cuenta los por_pedido como traídos de otra sucursal", …);
// venta-sin-stock.test.ts
it("idsAPedido por entrega", () => {
  expect([...idsAPedido(PRODUCTOS, { tipo: "envio", local: null })]).toEqual(["p1"]);
  expect([...idsAPedido(PRODUCTOS, { tipo: "retiro", local: "mdp" })]).toEqual([]);
});
// stock-sucursal.test.ts: sin modalidades el select de productos es el de hoy; con lista, lleva la columna y arma `modalidad`
```

- [ ] **Step 2: Correr.** `cd apps/clientes && npx vitest run --project unit src/lib/sucursales.test.ts src/lib/sucursales-pedido.test.ts src/lib/sucursales-disponibilidad.test.ts src/lib/disponibilidad-textos.test.ts src/lib/stock-sucursal.test.ts src/lib/venta-sin-stock.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Los `switch`/`Record` exhaustivos sobre `EstadoEnvio`/`EstadoRetiro` que `tsc` marque (ficha, carrito, checkout) se completan con el mismo trato que `a_traer`/`con_demora`.
- [ ] **Step 4: Correr** → PASS; `npm test` completo; `npx tsc --noEmit`; eslint.
- [ ] **Step 5: Commit.** `git add apps/clientes/src/lib/sucursales.ts apps/clientes/src/lib/sucursales.test.ts apps/clientes/src/lib/sucursales-pedido.ts apps/clientes/src/lib/sucursales-pedido.test.ts apps/clientes/src/lib/sucursales-disponibilidad.ts apps/clientes/src/lib/sucursales-disponibilidad.test.ts apps/clientes/src/lib/stock-sucursal.ts apps/clientes/src/lib/stock-sucursal.test.ts apps/clientes/src/lib/disponibilidad-vista.ts apps/clientes/src/lib/disponibilidad-textos.ts apps/clientes/src/lib/disponibilidad-textos.test.ts apps/clientes/src/lib/venta-sin-stock.ts apps/clientes/src/lib/venta-sin-stock.test.ts && git commit -m "feat(clientes): estado por_pedido en la disponibilidad por sucursal"` (más los componentes que `tsc` haya obligado a tocar)

---

### Task 12: Shop — cotización y carrito

**Files:**
- Modify: `apps/clientes/src/lib/cotizacion.ts` (`LineaCotizada` ~51, `Cotizacion` ~76, `cotizarItem` ~143, `FilaEspejo` ~207, `leerEspejo` ~267, `cotizar` ~322), `apps/clientes/src/lib/medios-precio.ts` (nueva `listaAConfirmar`, junto a `seleccionarMediosPrecio`: en `lista-medio.ts` haría un ciclo, porque `medios-precio` ya importa `lista-medio`), `apps/clientes/src/app/api/carrito/cotizar/route.ts`, `apps/clientes/src/components/CarritoClient.tsx` (~400, ~440, aviso)
- Test: `apps/clientes/src/lib/cotizacion.test.ts`, `apps/clientes/src/lib/cotizacion-espejo.test.ts`, `apps/clientes/src/lib/medios-precio.test.ts`, `apps/clientes/src/app/api/carrito/cotizar/route.venta-sin-stock.test.ts` (nuevo, patrón de `route.disponibilidad.test.ts`)

**Interfaces:**
- Consumes: `modalidadesActivas`, `modalidadPorId`, `lineaAPedido`, `flujoDelPedido`, `idsAPedido`, `TEXTO_CARRITO_A_CONFIRMAR` (Task 6/11); `topeCantidad` (Task 9, `catalogo-vista.ts`); `localDeRetiro` (Task 11); `sinProcesadoresNoConfigurados` (`medios-pago-datos.ts`, sólo en la ruta).
- Produces:
  - `LineaCotizada.ventaSinStock?: VentaSinStock` (la línea va "a pedido": sin `problema`, suma en los totales) y `LineaCotizada.aceptaSinStock?: true` (el producto tiene modalidad activa, aunque la línea tenga stock).
  - `Cotizacion.flujo: FlujoPedido` (`flujoDelPedido(lineas)`).
  - `cotizarItem(pedida, item, idListaMedio?, precioPrivado?, venta?: { modalidad: VentaSinStock; aPedido?: boolean })`: tras inactivo / sin precio (que siguen bloqueando igual), si `venta` → `aceptaSinStock`; la línea va a pedido si `venta.aPedido ?? lineaAPedido({ stockDisponible, qty, modalidad })`; si no, los `sin_stock` / `stock_insuficiente` de hoy.
  - `FilaEspejo.modalidadId?: string | null`; `leerEspejo` lee `modalidadesActivas()` y selecciona `crmOverlay.modalidadSinStockId` SÓLO con lista no vacía (con `joinOverlay(agrupar)`: la del ancla).
  - `cotizar(pedidas, opts & { aPedido?: ReadonlySet<string> })`: con `aPedido` (flag `disponibilidad-sucursal`) la decisión por línea es `aPedido.has(id)` (sólo si el producto tiene modalidad activa); sin él, `lineaAPedido` contra el stock de la línea.
  - `listaAConfirmar(medios: readonly MedioPago[]): string | undefined` = `seleccionarMediosPrecio(medios, false).destacado?.idListaPrecios || undefined` (la lista que muestran las cards; sin destacado → general). Las rutas la llaman con `sinProcesadoresNoConfigurados(medios)`, el mismo filtro que `mediosOfrecibles()` usa para las cards.
  - Respuesta de `/api/carrito/cotizar`: suma `flujo`.
- Decisión central (Review Focus 4): con el flag, la ruta calcula PRIMERO `disponibilidadParaMostrar` (ya lo hacía, ahora antes de cotizar) y le pasa a `cotizar` `aPedido = idsAPedido(disponibilidad.productos, { tipo: entregaTipo, local })`, con `local = body.sucursalRetiro` o `localDeRetiro(…)` con las sucursales cacheadas y la provincia; así el carrito decide con `origenDeLinea` y las reglas reales, no con la unión permisiva de `contextoUnion`. Sin el flag (o si la disponibilidad falla → `null`) decide `lineaAPedido`.
- Decisión de precio: con `flujo === "a_confirmar"` y sin cuenta corriente ni lista privada, la ruta recotiza con `idListaMedio = listaAConfirmar(medios)` (todas las líneas, también las que tienen stock) y omite `cuotasOpciones`, `totalesOpciones`, `proximoEscalon`, `progresoCuotas` y `cuentaTransferencia` (no se cobra en línea). Un destacado sólo con listas por forma (sin `idListaPrecios`) cae a la lista general: una lista por pedido no puede seguir el "más barato por producto" de la card.
- Carrito: tope del selector `topeCantidad(linea)` en vez de `linea?.stockDisponible ?? 999`; "Stock máximo disponible" sólo sin `aceptaSinStock`; bajo una línea a pedido, su `ventaSinStock.texto`; con `cotizacion.flujo === "a_confirmar"`, `TEXTO_CARRITO_A_CONFIRMAR` sobre "Iniciar compra".

- [ ] **Step 1: Tests que fallan.**

```ts
// cotizacion.test.ts (cotizarItem, puro)
it("sin stock con modalidad: a pedido, sin problema", () => {
  const l = cotizarItem({ id: "1", qty: 2 }, item({ stock: 0 }), undefined, undefined, { modalidad: M });
  expect(l).toMatchObject({ ventaSinStock: M, aceptaSinStock: true, subtotal: 200 });
  expect(l.problema).toBeUndefined();
});
it("cantidad > stock con modalidad: la línea entera a pedido", () =>
  expect(cotizarItem({ id: "1", qty: 5 }, item({ stock: 3 }), undefined, undefined, { modalidad: M })).toMatchObject({ qty: 5, ventaSinStock: M }));
it("con stock suficiente y modalidad: normal pero acepta sin stock", () => {
  const l = cotizarItem({ id: "1", qty: 1 }, item({ stock: 3 }), undefined, undefined, { modalidad: M });
  expect(l.ventaSinStock).toBeUndefined(); expect(l.aceptaSinStock).toBe(true);
});
it("sin modalidad: sin_stock y stock_insuficiente como hoy", …);
it("aPedido del motor manda aunque la unión tenga stock (traslado apagado)", () =>
  expect(cotizarItem({ id: "1", qty: 1 }, item({ stock: 5 }), undefined, undefined, { modalidad: M, aPedido: true }).ventaSinStock).toEqual(M));
it("inactivo y sin precio siguen bloqueando con modalidad", …);
// cotizacion-espejo.test.ts
it("modalidad desactivada (no está en activas) → la línea vuelve a sin_stock", async () => {
  vi.mocked(modalidadesActivas).mockResolvedValue([]);
  expect((await cotizar([{ id: "1", qty: 1 }])).lineas[0].problema).toBe("sin_stock");
});
it("sin modalidades el SQL de leerEspejo es el de hoy", …);
it("mixto: flujo a_confirmar con una sola línea a confirmar", …);
// medios-precio.test.ts
it("listaAConfirmar: la del destacado; sin destacado o sólo por forma → undefined", …);
// route.venta-sin-stock.test.ts
it("flag on, traslado apagado: aPedido del motor llega a cotizar y la línea va a pedido", …);
it("a_confirmar: recotiza con la lista del destacado y no trae cuotas ni totalesOpciones", …);
it("en_linea: cotiza con la lista del medio elegido, como siempre", …);
```

- [ ] **Step 2: Correr.** `cd apps/clientes && npx vitest run --project unit src/lib/cotizacion.test.ts src/lib/cotizacion-espejo.test.ts src/lib/medios-precio.test.ts src/app/api/carrito/cotizar` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** → PASS (incluidos los `route.*.test.ts` de cotizar existentes, sin cambios); `npx tsc --noEmit`; eslint.
- [ ] **Step 5: Commit.** `git add apps/clientes/src/lib/cotizacion.ts apps/clientes/src/lib/cotizacion.test.ts apps/clientes/src/lib/cotizacion-espejo.test.ts apps/clientes/src/lib/medios-precio.ts apps/clientes/src/lib/medios-precio.test.ts apps/clientes/src/app/api/carrito/cotizar/route.ts apps/clientes/src/app/api/carrito/cotizar/route.venta-sin-stock.test.ts apps/clientes/src/components/CarritoClient.tsx && git commit -m "feat(clientes): la cotización resuelve las líneas a pedido y su flujo"`

---

### Task 13: Shop — creación del pedido (compuertas, snapshot, a confirmar)

**Files:**
- Modify: `apps/clientes/src/app/api/pedidos/route.ts` (validación del pago ~243, cotización ~372, errores ~502, respuesta ~578), `apps/clientes/src/lib/pedido-medio.ts` (`OpcionesCotizarMedio`, `cotizarConMedio`), `apps/clientes/src/lib/medios-pago.ts` (`SLUG_A_COORDINAR`, `pagoValidoConMedios` ~223), `apps/clientes/src/lib/pedidos.ts` (`crearPedido` ~205: `LineaEntrada.porPedido` ~281, `faltan` ~423, snapshot en el insert ~431)
- Test: `apps/clientes/src/app/api/pedidos/route.venta-sin-stock.test.ts` (nuevo, patrón de `route.disponibilidad.test.ts` / `route.medios.test.ts`), `apps/clientes/src/lib/pedidos.disponibilidad.test.ts`, `apps/clientes/src/lib/pedidos.test.ts`, `apps/clientes/src/lib/medios-pago.test.ts`, `apps/clientes/src/lib/pedido-medio.test.ts`, `apps/clientes/src/app/api/pedidos/[id]/medio/route.test.ts` (caracterización)

**Interfaces:**
- Consumes: `cotizar(… { aPedido })`, `Cotizacion.flujo`, `listaAConfirmar` (Task 12); `idsAPedido`, `localDeRetiro`, `disponibilidadParaMostrar` (Task 11); `leerModalidadesActivas`, `snapshotLinea`, `VentaSinStockCambioError` (Task 6).
- Produces:
  - `SLUG_A_COORDINAR = "a_coordinar"` (y `SLUGS_RESERVADOS` lo usa); `pagoValidoConMedios(medios, entrega, pagoMetodo, opts?: OpcionesMedios & { aConfirmar?: boolean })` — con `aConfirmar` acepta `a_coordinar` aunque haya medios aplicables.
  - `cotizarConMedio({ …, aPedido?: ReadonlySet<string>, idListaAConfirmar?: string })` → `ResultadoMedio` ok suma `flujo: FlujoPedido`; con `pagoMetodo === SLUG_A_COORDINAR`, sin lista privada, `flujo === "a_confirmar"` e `idListaAConfirmar`, recotiza con esa lista (`idListaMedio` devuelto = ésa, así `orders.id_price_list` deja constancia); `cuotasPedido` y `formaCobro` quedan `null`. `OpcionesCotizarMedio.aPedido?` viaja a las recotizaciones del 409.
  - `crearPedido`: con el flag, `lineas` de la asignación llevan `porPedido: Boolean(lineaCotizada.ventaSinStock)`; sin el flag, `faltan` excluye las líneas con `ventaSinStock` (un id fuera del espejo sigue siendo error); antes de insertar, `leerModalidadesActivas(tx)` y por cada línea a pedido su modalidad fresca: si falta o su `flujo` difiere del cotizado → `throw new VentaSinStockCambioError(ids)`; si no, `ventaSinStock: snapshotLinea(m)` (líneas normales: `null`). Origen de una línea a pedido = la sucursal del pedido (`aTraerDe` null).
  - La respuesta del POST ya trae `cotizacion` (con `flujo`): el checkout lee `respuesta.cotizacion.flujo`; no hace falta un campo nuevo.
  - Reservas: una línea a pedido cuenta en `shop.stock_reservado` como cualquier otra (la vista no cambia; efecto aceptado en el spec).
- Orden nuevo de `POST /api/pedidos` (decisión): (1) si `pagoMetodo === SLUG_A_COORDINAR` y `pagoValidoConMedios` lo rechaza, NO se responde todavía (queda "pendiente de flujo"); los demás medios se validan como hoy. (2) Con el flag, `disponibilidadParaMostrar(ids, disp, cantidades, agrupar)` y `aPedido = idsAPedido(…, { tipo: entregaTipo, local: sucursalEntrada.sucursalRetiro ?? localDeRetiro(…) })`. (3) `cotizarConMedio({ …, aPedido, idListaAConfirmar: listaAConfirmar(sinProcesadoresNoConfigurados(mediosCrm)) })`. (4) Con `flujo === "a_confirmar"` y comprador SIN cuenta corriente: si `pagoMetodo !== SLUG_A_COORDINAR` → 409 `{ error: "Su pedido incluye productos que se confirman por contacto. Revise el pedido para continuar.", motivo: "pedido_a_confirmar", cotizacion }` (nunca se pisa en silencio un medio en línea); si es `a_coordinar` → válido (`pagoValidoConMedios(…, { aConfirmar: true })`). Con `flujo === "normal"` y el `a_coordinar` pendiente → el mismo 400 de hoy (`"Ese medio de pago no está disponible para la entrega elegida."`). Cuenta corriente: sin cambios (su medio; las líneas a pedido sólo suman su snapshot). (5) `VentaSinStockCambioError` se maneja como `StockInsuficienteError`: `productosCambiaron(await cotizar(lineas, opcionesCotizar))`.
- `/api/pedidos/[id]/medio`: `medioAdmiteCambio("a_coordinar")` ya es `false` → 409 `no_cambia`; sólo test de caracterización (sin código).

- [ ] **Step 1: Tests que fallan.**

```ts
// route.venta-sin-stock.test.ts
it("mixto en_linea + a_confirmar + con stock: pedido a_coordinar con la lista del destacado en todas las líneas", async () => {
  const r = await POST(req({ items: [enLinea, aConfirmar, conStock], pagoMetodo: "a_coordinar" }));
  expect(r.status).toBe(201);
  expect(crearPedidoSpy).toHaveBeenCalledWith(
    expect.objectContaining({ idPriceList: "lista-destacado" }),
    expect.objectContaining({ pagoMetodo: "a_coordinar", cuotas: null, formaCobro: null }),
    expect.anything());
});
it("a_confirmar con un medio en línea en el body → 409 pedido_a_confirmar con la cotización", …);
it("sólo en_linea: checkout normal; a_coordinar con medios aplicables → 400 como hoy", …);
it("cuenta corriente con una línea a confirmar: sigue con su medio", …);
it("modalidad desactivada entre cotización y transacción → 409 con la recotización", …);
// pedidos.disponibilidad.test.ts / pedidos.test.ts (crearPedido, dbGrabadora)
it("flag on: la línea a pedido no dispara SucursalPedidoError y sale de la sucursal del pedido", …);
it("flag off: disponiblesEnTx no cuenta como faltante la línea a pedido; la normal sin stock sigue tirando", …);
it("inserta el snapshot en venta_sin_stock y null en las líneas normales", …);
it("flujo distinto al cotizado → VentaSinStockCambioError", …);
// medios-pago.test.ts
it("a_coordinar con medios aplicables sólo con aConfirmar", () => {
  expect(pagoValidoConMedios(MEDIOS, "retiro", "a_coordinar")).toBe(false);
  expect(pagoValidoConMedios(MEDIOS, "retiro", "a_coordinar", { aConfirmar: true })).toBe(true);
});
// [id]/medio/route.test.ts
it("un pedido a_coordinar no puede pasar a un medio en línea (409 no_cambia)", …);
```

- [ ] **Step 2: Correr.** `cd apps/clientes && npx vitest run --project unit src/app/api/pedidos src/lib/pedidos.disponibilidad.test.ts src/lib/pedidos.test.ts src/lib/medios-pago.test.ts src/lib/pedido-medio.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** → PASS (todos los `route.*.test.ts` de pedidos existentes sin cambios); `npx tsc --noEmit`; eslint.
- [ ] **Step 5: Commit.** `git add apps/clientes/src/app/api/pedidos/route.ts apps/clientes/src/app/api/pedidos/route.venta-sin-stock.test.ts "apps/clientes/src/app/api/pedidos/[id]/medio/route.test.ts" apps/clientes/src/lib/pedido-medio.ts apps/clientes/src/lib/pedido-medio.test.ts apps/clientes/src/lib/medios-pago.ts apps/clientes/src/lib/medios-pago.test.ts apps/clientes/src/lib/pedidos.ts apps/clientes/src/lib/pedidos.test.ts apps/clientes/src/lib/pedidos.disponibilidad.test.ts && git commit -m "feat(clientes): pedidos con líneas a pedido y pedido a confirmar por modalidad"`

---

### Task 14: Shop — checkout a confirmar, confirmación, mails y Mi cuenta

**Files:**
- Create: `apps/clientes/src/lib/checkout-flujo.ts` (puro)
- Modify: `apps/clientes/src/components/CheckoutClient.tsx` (`PASOS_CHECKOUT` ~125, `pagoParaEnviar` ~796, pantalla de éxito ~1453), `apps/clientes/src/lib/pedido-mail.ts` (`LineaMail` ~28, `DatosMailPedido`, `COPY.recibido` ~148, `resumen` ~183, texto plano), `apps/clientes/src/lib/pedido-avisos.ts` (~89 y ~302: leer `orderItems.ventaSinStock`), `apps/clientes/src/data/orders.ts` (`OrderItem.aPedido?`, `Order.aConfirmar?`), `apps/clientes/src/lib/pedidos.ts` (`armarOrder` ~559), `apps/clientes/src/lib/pedido-vista.ts` (`subtituloLinea` ~13), `apps/clientes/src/components/mi-cuenta/PedidoDetalle.tsx` (tarjeta Pago), `apps/clientes/src/app/mi-cuenta/pedidos/[id]/page.tsx` (contacto)
- Test: `apps/clientes/src/lib/checkout-flujo.test.ts`, `apps/clientes/src/lib/pedido-mail.test.ts`, `apps/clientes/src/lib/pedido-avisos-operador.test.ts`, `apps/clientes/src/lib/pedidos.test.ts` (`armarOrder`), `apps/clientes/src/lib/pedido-vista.test.ts`, `apps/clientes/src/components/mi-cuenta/PedidoDetalle.comprobante.test.ts` (un caso)

**Interfaces:**
- Consumes: `Cotizacion.flujo` (Task 12), `cotizacion.flujo` de la respuesta del POST (Task 13), `leerSnapshot`, `pedidoAConfirmarPorModalidad`, `TEXTO_PEDIDO_A_CONFIRMAR`, `TEXTO_CARRITO_A_CONFIRMAR` (Task 6); `contactoDelPedido` (`contacto-pedido-repo.ts`), `PedidoContacto`.
- Produces:
  - `type PasoCheckout = "datos" | "entrega" | "pago"` (se mueve acá desde `CheckoutClient`), `pasosCheckout(a: { flujo: FlujoPedido; esCuentaCorriente: boolean }): PasoCheckout[]` (a confirmar sin cuenta corriente → `["datos", "entrega"]`), `pagoAEnviar(a: { flujo: FlujoPedido; esCuentaCorriente: boolean; medioSlug: string | null }): string` (a confirmar sin cuenta corriente → `"a_coordinar"`; si no `medioSlug ?? "a_coordinar"`, lo de hoy).
  - Checkout: el flujo sale de su cotización (`/api/carrito/cotizar`); a confirmar → el paso "Entrega" termina en "Confirmar pedido", con `TEXTO_CARRITO_A_CONFIRMAR` sobre el botón; si el POST responde 409 `pedido_a_confirmar`, se toma la cotización devuelta (cambia el flujo) y se vuelve a "Entrega". Éxito con `respuesta.cotizacion.flujo === "a_confirmar"` (guardado en `confirmado`): título `"Pedido recibido"` (el de hoy), cuerpo `TEXTO_PEDIDO_A_CONFIRMAR` y `PedidoContacto` con el plazo (el bloque existente).
  - Mail: `LineaMail.aPedido?: string` (texto de la línea: en HTML una segunda línea gris bajo el nombre; en texto plano `"- {nombre} × {n} ({aPedido})"`); `DatosMailPedido.aConfirmar?: boolean` → bajada de "recibido": `"Registramos su pedido. Quedó a confirmar y no se realizó ningún cobro: nos comunicaremos con usted para confirmarlo. Le avisaremos por este medio cada vez que avance."`; el mail al operador también lleva `aPedido` por línea.
  - Mi cuenta: `OrderItem.aPedido?: string` (`leerSnapshot(i.ventaSinStock)?.texto` — sale del snapshot, así un pedido sigue mostrándose aunque la modalidad se haya borrado); `Order.aConfirmar?: boolean` (`pedidoAConfirmarPorModalidad`); `subtituloLinea` agrega `item.aPedido` al final (`"Cód. X · 2 u. · A pedido"`); la tarjeta "Pago" con `aConfirmar` muestra `"A confirmar: no se realizó ningún cobro. Nos comunicaremos con usted para confirmar el pedido."` y la página carga `contactoDelPedido(id, numero)` para `PedidoContacto`.

- [ ] **Step 1: Tests que fallan.**

```ts
it("pasos y pago a confirmar", () => {
  expect(pasosCheckout({ flujo: "a_confirmar", esCuentaCorriente: false })).toEqual(["datos", "entrega"]);
  expect(pasosCheckout({ flujo: "a_confirmar", esCuentaCorriente: true })).toEqual(["datos", "entrega", "pago"]);
  expect(pagoAEnviar({ flujo: "a_confirmar", esCuentaCorriente: false, medioSlug: "mercadopago" })).toBe("a_coordinar");
  expect(pagoAEnviar({ flujo: "normal", esCuentaCorriente: false, medioSlug: "mercadopago" })).toBe("mercadopago");
});
it("mail recibido a confirmar: sin cobro y con el texto por línea", () => {
  const m = armarMailPedido({ ...BASE, aviso: "recibido", aConfirmar: true, lineas: [{ nombre: "Panel", cantidad: 2, aPedido: "A pedido" }] });
  expect(m.text).toContain("no se realizó ningún cobro");
  expect(m.text).toContain("- Panel × 2 (A pedido)");
  expect(m.html).toContain("A pedido");
});
it("mail sin modalidad: igual que hoy (snapshot del texto)", …);
it("armarOrder: modalidad borrada → el texto sale del snapshot; jsonb roto → sin aPedido", …);
it("subtituloLinea con aPedido", () => expect(subtituloLinea({ codigo: "X", nombreVisible: "P", qty: 2, price: 1, aPedido: "A pedido" })).toBe("Cód. X · 2 u. · A pedido"));
it("PedidoDetalle a confirmar muestra el aviso sin cobro", …);
```

- [ ] **Step 2: Correr.** `cd apps/clientes && npx vitest run --project unit src/lib/checkout-flujo.test.ts src/lib/pedido-mail.test.ts src/lib/pedido-avisos-operador.test.ts src/lib/pedidos.test.ts src/lib/pedido-vista.test.ts src/components/mi-cuenta` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** → PASS (incluida `components/mi-cuenta/sin-literales.test.ts`: tokens del DS, sin voseo); `npx tsc --noEmit`; eslint.
- [ ] **Step 5: Commit.** `git add apps/clientes/src/lib/checkout-flujo.ts apps/clientes/src/lib/checkout-flujo.test.ts apps/clientes/src/components/CheckoutClient.tsx apps/clientes/src/lib/pedido-mail.ts apps/clientes/src/lib/pedido-mail.test.ts apps/clientes/src/lib/pedido-avisos.ts apps/clientes/src/lib/pedido-avisos-operador.test.ts apps/clientes/src/data/orders.ts apps/clientes/src/lib/pedidos.ts apps/clientes/src/lib/pedidos.test.ts apps/clientes/src/lib/pedido-vista.ts apps/clientes/src/lib/pedido-vista.test.ts apps/clientes/src/components/mi-cuenta/PedidoDetalle.tsx apps/clientes/src/components/mi-cuenta/PedidoDetalle.comprobante.test.ts "apps/clientes/src/app/mi-cuenta/pedidos/[id]/page.tsx" && git commit -m "feat(clientes): checkout, confirmación, mails y Mi cuenta de pedidos a confirmar"`

---

### Task 15: Verificación final

**Files:** ninguno nuevo (sólo arreglos que aparezcan, cada uno con su test).

- [ ] **Step 1: Suites unitarias.** `cd apps/clientes && npm test` y `cd apps/admin && npm test` → PASS.
- [ ] **Step 2: Tipos y lint.** `npx tsc --noEmit` en las dos apps; `npx eslint` sobre todos los archivos tocados (`git diff --name-only origin/staging...HEAD -- apps/clientes apps/admin`).
- [ ] **Step 3: Guardas.** `.github/scripts/repo-guard.sh tree` → OK; `git grep -n -i -E "coresa|macroled|led premium" -- apps/*/src apps/*/drizzle` sin resultados en código nuevo.
- [ ] **Step 4: Integración** (si hay Postgres local): `cd apps/admin && npm run test:integration` y `cd apps/clientes && npm run test:integration` → PASS (el contrato `crm-contrato.json` contra la base migrada incluido).
- [ ] **Step 5: Build.** `cd apps/clientes && npx next build` → sin errores (Cache Components: ningún `cacheTag`/`cacheLife` fuera de `'use cache'`).
- [ ] **Step 6: Humo en el navegador** (local, con 0094 y 0039 aplicadas en la base local): crear en Envíos una modalidad en línea ("Retiro en ~48 h", 2 días) y una a confirmar ("A pedido", a coordinar); asignarlas a dos productos sin stock (una por diálogo, otra por la acción masiva filtrando por marca); verificar card (texto ámbar, botón habilitado), ficha (pill, aviso "Se confirma por contacto…", sin cuotas en la a confirmar), "Solo con stock" los lista; carrito con las dos + uno con stock → aviso a confirmar; checkout sin paso Pago → "Pedido recibido" con el contacto; en el CRM el pedido muestra "A pedido · … · …" y "2 productos a pedido" sin "Falta stock"; desactivar la modalidad → vuelve "Sin stock" y no se puede agregar. Anotar el resultado en la descripción del PR.
- [ ] **Step 7: Commit** de los arreglos (si hubo), con rutas explícitas y `fix(clientes|admin): …`.
