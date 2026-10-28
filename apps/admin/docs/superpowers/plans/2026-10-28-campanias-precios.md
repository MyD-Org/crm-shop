# Campañas de precios: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** campañas con nombre y ventana horaria que bajan el precio online por %, se activan y terminan solas, y se ven tachadas en todo el catálogo de la tienda, con límite de unidades opcional.

**Arquitectura:**

- **CRM:** guarda campañas y reglas, y materializa por producto los precios de campaña en `catalog_products.campanias_online` (jsonb), sin tocar `precios_online`.
- **Shop:**
  - Lee esa columna por la vista `catalog_products_shop`.
  - Decide en cada request qué campañas están activas, como hace `flagsPublicos()`.
  - Pasa las ids activas como argumento a las funciones cacheadas. Así la caché se parte sola en el inicio y en el fin, sin cron.
  - Una sola función pura (`resolverPrecioVigente`) decide el precio para exhibir y para cobrar.

**Tecnología:** Next.js (apps con `cacheComponents`), Drizzle + Postgres, Vitest (proyectos `unit` e `integration`), `@myd-org/ui`.

**Spec:** `apps/admin/docs/superpowers/specs/2026-10-28-campanias-precios-design.md`. Leerla entera antes de la primera tarea.

## Restricciones globales

- **Cómo correr las cosas:** cada app se corre parada en su carpeta, con sus propios `npm test`, `npm run test:integration` y `npm run lint`, más `npx tsc --noEmit`. No hay workspaces.
- **Repo público:** fixtures sintéticos, dominios `.example`. Nunca `git add -A` ni `git add .`; agregar rutas explícitas. `.github/scripts/repo-guard.sh tree` debe pasar.
- **Textos de UI** nuevos o modificados en **usted** ("Seleccione", "su"). Botones en infinitivo.
- **Migraciones del CRM** (`apps/admin/drizzle`):
  - Numerarlas con el siguiente número libre al implementar. Hoy es 0094 en `main`, pero el PR #695 ya lo usa: si ese PR mergeó, corresponde 0095.
  - Una migración escrita a mano obliga a correr `npx tsx scripts/drizzle-snapshot.ts`.
  - Se aplican a mano en producción antes de mergear el código que las usa.
- **Migración del Shop** (`apps/clientes/drizzle`): siguiente número libre (0039 o 0040, según #695). Se aplica después de la del CRM.
- **Contrato CRM↔Shop:**
  - La vista `catalog_products_shop` se cambia sólo agregando columnas al final, con `CREATE OR REPLACE VIEW` y el bloque de GRANT condicional a `shop_app` (patrón de `0083_vista_shop_variantes.sql`).
  - Actualizar `apps/clientes/src/db/crm.ts`, `apps/clientes/src/db/__fixtures__/crm-contrato.json` y el doc del contrato en el repo `MyD-Org/platform` (`owns/platform`, en la carpeta `contracts/`).
- **Hora:** de Argentina, `-03:00`. El fin es exclusivo: activa ⇔ `inicio <= ahora < fin`.
- **Precio de campaña neto por lista:** `round(precio_normal × (100 − pct) / 100, 2)`. El `pct` es un entero de 0 a 90; 0 en una regla de producto significa "excluido". El IVA lo suma el Shop (`precioFinal`).
- **Precedencia dentro de una campaña:** producto > marca > categoría más profunda. Si empatan dos categorías del mismo nivel, gana el % mayor.
  - Una regla de producto alcanza a todo el modelo: `coalesce(grupo_id, alegra_id)` del producto elegido.
  - La categoría se resuelve contra `catalog_overlay` por `coalesce(p.grupo_id, p.alegra_id)`.
- **Listas:**
  - La campaña se aplica a todas las listas públicas activas, con el mismo %.
  - Las listas privadas no se materializan. Una cuenta privada paga `min(privado, campaña de la lista general)`.
- **Superposición:** dos campañas del mismo tenant no pueden tener ventanas que se pisen; se valida al guardar. Que una termine justo cuando empieza otra está permitido.
- **Gracia de 24 h:** `campanias_shop` y `campanias_online` conservan las campañas terminadas hace menos de 24 h.

## Foco de revisión

1. **Borde de reloj con caché caliente.** Una página cacheada a las 23:59:50 no puede seguir mostrando la campaña a las 00:00:10 si terminó, ni dejar de mostrarla si empezó. → Tarea 9: test de `idsActivasEn` en los bordes y test de que la clave cambia.
2. **Capas dentro de una campaña.** Marca X al 20 %, un producto de X al 0 %, y una variante cuya categoría está sólo en el ancla. → Tarea 1: casos en la matriz del oráculo.
3. **Cambio de costo durante una campaña activa.** La sync de Alegra reescribe `precios_online`; el precio de campaña tiene que seguirlo. → Tarea 2: test de `aplicar_precios_online(..., 'costo')`.
4. **Pedido pendiente que cambia de medio de pago después del fin.** Creado a las 23:59 y cambiado a las 00:30, conserva el precio de campaña; creado después del fin, paga el normal. → Tarea 13: test de integración en `cambiar-medio-pedido`.
5. **Última unidad en carrera.** Dos pedidos simultáneos por la última unidad de campaña; un pedido cancelado la libera; el límite de un modelo se comparte entre sus variantes. → Tarea 16: integración en el estilo de `crear-pedido-carrera`.

---

## Parte 1: CRM (PR 1, `apps/admin`)

### Tarea 1: tablas, cálculo de campañas y oráculo

**Archivos:**
- Crear: `apps/admin/drizzle/00NN_campanias.sql`
- Modificar: `apps/admin/src/db/schema.ts` (tablas `campanias`, `campaniaReglas`; columna `catalogProducts.campaniasOnline`)
- Crear: `apps/admin/src/lib/campanias-oraculo.ts` y su test unitario
- Crear: `apps/admin/test/integration/campanias-calculo.integration.test.ts`
- Modificar: `apps/admin/test/integration/precios-online-helpers.ts` (siembra de campañas)

**Interfaces:**
- Produce la función SQL `calcular_campanias_online(p_tenant text, p_ids text[] DEFAULT NULL) RETURNS TABLE (alegra_id text, campania_id uuid, regla_id uuid, pct smallint, unidades integer)`. Devuelve una fila por producto y campaña no terminada hace más de 24 h (`fin > now() - interval '24 hours'`) que lo alcanza con `pct > 0`.
- Produce, en TypeScript, `calcularCampaniasOraculo(productos: ProductoOraculo[], campanias: CampaniaOraculo[], categorias: CategoriaOraculo[]): Map<string, { campaniaId: string; reglaId: string; pct: number; unidades: number | null }[]>`. Reusa los tipos de `precios-online-oraculo.ts` y agrega `grupoId`.
- Produce los helpers de test `seedCampania(tenant, { nombre, inicio, fin, etiqueta? }): Promise<string>` y `seedRegla(tenant, campaniaId, { tipo, alegraId?, marca?, categoriaId?, pct, unidades? }): Promise<string>`.

Contenido de la migración:

- **`campanias`:** `id uuid pk default gen_random_uuid()`, `tenant_id text not null` (FK a tenants como las demás tablas de precios), `nombre text not null`, `etiqueta text not null`, `inicio timestamptz not null`, `fin timestamptz not null`, `creado_por text`, `created_at`, `updated_at`. `CHECK (fin > inicio)`. Índice `(tenant_id, fin)`.
- **`campania_reglas`:** `id uuid pk`, `tenant_id`, `campania_id uuid not null references campanias on delete cascade`, `tipo text` (`producto|marca|categoria`), `alegra_id text`, `marca text`, `categoria_id uuid`, `pct smallint not null CHECK (pct between 0 and 90)`, `unidades integer CHECK (unidades IS NULL OR (unidades >= 1 AND tipo = 'producto'))`.
  - CHECK de forma igual a `lista_precio_overrides_forma_chk` de 0088, con la marca en `lower(btrim())`.
  - Índices únicos parciales por `(campania_id, alegra_id | marca | categoria_id)`.
- **`catalog_products`:** `ADD COLUMN campanias_online jsonb`.

Algoritmo SQL (lo que la firma no determina):

```sql
-- base: productos del tenant (p_ids opcional) con
--   g      = coalesce(p.grupo_id, p.alegra_id)
--   marca  = nullif(lower(btrim(p.brand)), '')
--   cat    = o.categoria_id, de catalog_overlay unido por (tenant, alegra_id = g)
-- camp: campañas con fin > now() - interval '24 hours'
-- r_prod: reglas de producto; rp = catalog_products de r.alegra_id;
--         pegan si coalesce(rp.grupo_id, rp.alegra_id) = base.g
-- r_marca: pegan por r.marca = base.marca
-- r_cat:  ancestros como en calcular_precios_online (CTE recursivo, UNION);
--         DISTINCT ON (alegra_id, campania_id) ORDER BY nivel DESC, pct DESC
-- resultado por (alegra_id, campania_id): coalesce(prod, marca, cat);
--         descartar si el pct elegido es 0
```

- [ ] **Paso 1: test unitario del oráculo** (`campanias-oraculo.test.ts`). Casos, con datos inventados:
  - Regla de marca "acme" al 20 % → un producto de marca " ACME " recibe pct 20.
  - Marca 20 % + producto P1 al 0 % → P1 sin entrada; el resto, 20.
  - Producto al 30 % + marca al 20 % → producto 30.
  - Categoría hija al 15 % y madre al 10 % → 15. Dos categorías del mismo nivel al 10 y al 12 → 12.
  - La variante V2 del modelo M (`grupoId = "M"`, sin categoría propia; el ancla M está en la categoría C al 10 %) → 10.
  - Regla de producto sobre la variante V1 del modelo M → alcanza a V1, V2 y M.
  - Campaña terminada hace 25 h → sin entrada. Terminada hace 23 h → con entrada.
- [ ] **Paso 2:** `npm test -- campanias-oraculo` → FAIL (falta el módulo).
- [ ] **Paso 3:** implementar `calcularCampaniasOraculo`.
- [ ] **Paso 4:** `npm test -- campanias-oraculo` → PASS.
- [ ] **Paso 5: test de integración** `campanias-calculo.integration.test.ts`. Siembra la misma matriz y compara `SELECT * FROM calcular_campanias_online('t', NULL)` con el oráculo. Agrega un barrido aleatorio con semilla fija, como `precios-online-calculo.integration.test.ts`.
- [ ] **Paso 6:** escribir la migración y el `schema.ts`, y correr `npx tsx scripts/drizzle-snapshot.ts`.
- [ ] **Paso 7:** `npm run test:integration -- campanias-calculo` → PASS. También `npm test -- snapshot-al-dia` → PASS.
- [ ] **Paso 8:** commit:

  ```bash
  git add apps/admin/drizzle/00NN_campanias.sql apps/admin/drizzle/meta apps/admin/src/db/schema.ts apps/admin/src/lib/campanias-oraculo.ts apps/admin/src/lib/campanias-oraculo.test.ts apps/admin/test/integration/campanias-calculo.integration.test.ts apps/admin/test/integration/precios-online-helpers.ts
  git commit -m "feat(admin): campañas de precios: tablas y cálculo"
  ```

### Tarea 2: materialización, vista para el Shop y grants

**Archivos:**
- Modificar: la misma migración `00NN_campanias.sql`, porque todavía no se aplicó en ningún lado.
- Crear: `apps/admin/test/integration/campanias-materializacion.integration.test.ts`
- Modificar: `apps/admin/test/integration/catalog-products-shop-grants.integration.test.ts`

**Interfaces:**
- Consume `calcular_campanias_online` (tarea 1).
- Produce `aplicar_campanias_online(p_tenant text, p_ids text[] DEFAULT NULL) RETURNS integer`, la cantidad de filas actualizadas.
  - Toma `pg_advisory_xact_lock(hashtext('precios_online:' || p_tenant))`, que es reentrante.
  - Escribe `catalog_products.campanias_online` como arreglo ordenado por `inicio`, con este formato por entrada:

    ```json
    {"id","reglaId","inicio","fin","pct","unidades","precios":[{"idPriceList","price"}]}
    ```

  - `precios` sale de los elementos de `precios_online` (públicos) con `round(price * (100 - pct) / 100, 2)`.
  - Sin entradas, deja `NULL`. Sólo actualiza filas que cambian (`IS DISTINCT FROM`).
- Produce `aplicar_precios_online`: se reescribe copiando el cuerpo de `0068` y agregando `PERFORM aplicar_campanias_online(p_tenant, p_ids);` antes del `RETURN QUERY`.
- Produce la vista `campanias_shop (tenant_id, id, nombre, etiqueta, inicio, fin)` con `fin > now() - interval '24 hours'`, y `GRANT SELECT` condicional a `shop_app`.
- Produce `catalog_products_shop`: `CREATE OR REPLACE` copiando la definición de `0083` y agregando al final `p.campanias_online AS campanias_online`.
- Produce el CHECK de `precios_online_cambios.tipo`: la lista de `0068` más `'campania'`.

Pasos:

- [ ] **Paso 1: tests de integración.**
  - **Precio por lista:**
    - Costo 100; listas "Tarjeta cuotas" ×1,6 (referencia) y "Efectivo o Transferencia" ×1,3; campaña al 20 % por marca.
    - Tras `aplicar_campanias_online(T)`, `campanias_online[0].precios` = `[{price: 128.00}, {price: 104.00}]`.
    - `precios_online` sigue en 160,00 y 130,00.
  - **Lista privada:** la columna no lleva entradas de una lista privada.
  - **Cambio de costo (foco 3):** cambiar `costo` a 200 y correr `aplicar_precios_online(T, NULL, 'costo')` con el umbral de retención en 100 → campaña 256,00 y 208,00.
  - **Columna vacía:** borrar la campaña y volver a aplicar → `campanias_online IS NULL`.
  - **Grants:** `campanias_shop` y la columna nueva de la vista se pueden leer con el rol `shop_app` (patrón de `catalog-products-shop-grants`).
- [ ] **Paso 2:** `npm run test:integration -- campanias-materializacion` → FAIL.
- [ ] **Paso 3:** completar la migración y correr el snapshot.
- [ ] **Paso 4:** `npm run test:integration` → PASS, incluidas las suites de `precios-online-*`, que no deben cambiar.
- [ ] **Paso 5:** commit `feat(admin): campañas: materialización y vista para el Shop`.

### Tarea 3: repositorio y validación

**Archivos:**
- Crear: `apps/admin/src/lib/campanias-validar.ts` (puro) y su test
- Crear: `apps/admin/src/lib/campanias-repo.ts`
- Crear: `apps/admin/test/integration/campanias-repo.integration.test.ts`
- Modificar: `apps/admin/src/lib/precios-online-repo.ts` (`inversosDe` rechaza `tipo = 'campania'`)

**Interfaces:**
- Produce estos tipos:

  ```ts
  export type AlcanceRegla =
    | { tipo: "producto"; alegraId: string }
    | { tipo: "marca"; marca: string }
    | { tipo: "categoria"; categoriaId: string }

  export interface ReglaEntrada {
    alcance: AlcanceRegla
    pct: number
    unidades?: number | null
  }

  export interface CampaniaEntrada {
    nombre: string
    etiqueta?: string
    inicio: string // ISO con offset
    fin: string
    reglas: ReglaEntrada[]
  }

  export type EstadoCampania = "programada" | "activa" | "terminada"
  ```

- Produce, en `campanias-validar.ts`:
  - `validarCampania(e: unknown): { ok: true; valor: CampaniaEntrada } | { ok: false; errores: string[] }`.
  - `estadoCampania(c: { inicio: Date; fin: Date }, ahora: Date): EstadoCampania`.
- Produce, en `campanias-repo.ts`:
  - `listarCampanias(tenantId): Promise<CampaniaDto[]>`, con `estado` y `productos` (conteo de productos con entrada).
  - `leerCampania(tenantId, id): Promise<CampaniaDetalleDto | null>`.
  - `previsualizarCampania(tenantId, e: CampaniaEntrada, exceptoId?: string): Promise<PreviaCampania>`.
  - `guardarCampania(tenantId, e: CampaniaEntrada, actor: UsuarioActor, id?: string): Promise<{ id: string }>`.
  - `terminarCampania(tenantId, id, actor): Promise<void>`.
  - `eliminarCampania(tenantId, id, actor): Promise<void>`.
  - `PreviaCampania = { productos: number; bajoCosto: number; muestra: FilaPreviaCampania[]; choque: { id: string; nombre: string } | null }`.
  - `FilaPreviaCampania = { alegraId; nombre; costo; precios: { lista: string; normal: number; campania: number }[] }`.

Reglas:

- **Validación** (textos en usted):
  - nombre de 1 a 80 caracteres;
  - etiqueta de hasta 24 caracteres, por defecto el nombre;
  - `fin > inicio`;
  - al crear, `fin` en el futuro;
  - al menos una regla;
  - `pct` entero de 0 a 90;
  - `unidades` sólo en reglas de producto, entero ≥ 1;
  - sin reglas duplicadas para el mismo objetivo.
- **Lo que se puede hacer según el estado:**
  - Editar: programada o activa. Una activa no puede mover el `inicio`.
  - Terminar: sólo activa; pone `fin = now()`.
  - Eliminar: sólo programada.
  - Cualquier otro caso: `PreciosOnlineError` con un texto claro.
- **`guardarCampania`, en una sola transacción:**
  1. `lockTenant`.
  2. Valida el choque de fechas con `tstzrange(inicio, fin) && tstzrange($inicio, $fin)` contra las demás campañas del tenant.
  3. Reemplaza las reglas.
  4. `SELECT aplicar_campanias_online($tenant, NULL)`.
  5. Inserta en `precios_online_cambios`: `tipo 'campania'`, `objeto 'campania:<id>'`, `antes`/`despues` en jsonb y `resumen` (por ejemplo "Campaña Black Friday: 20 % en marca acme…").
  6. Después del commit, `avisarShop(tenantId)`, como `avisarTrasCommit`.
- **`bajoCosto`:** cantidad de productos cuyo precio de campaña de alguna lista queda por debajo de `costo_aplicado`.

Pasos:

- [ ] **Paso 1: tests unitarios de `validarCampania` y `estadoCampania`.**
  - `inicio = fin` → error "La fecha de fin debe ser posterior al inicio."
  - `pct` 95 → error.
  - `unidades` en una regla de marca → error.
  - Bordes de estado: `ahora = inicio` → activa; `ahora = fin` → terminada.
- [ ] **Paso 2:** FAIL → implementar → PASS.
- [ ] **Paso 3: tests de integración del repo.**
  - Guardar con choque de fechas tira. Dos campañas contiguas (fin de A = inicio de B) se guardan.
  - Guardar materializa `campanias_online` y deja una entrada en el historial.
  - Terminar una activa pone `fin ≤ now()`, y el producto sigue con la entrada (gracia de 24 h).
  - Eliminar una activa tira.
  - `previsualizarCampania` con un producto de costo 100 al 50 % y lista ×1,3 → precio 65 y `bajoCosto` 1.
  - `inversosDe` sobre una entrada de campaña tira `PreciosOnlineError("Las campañas se editan desde la solapa Campañas.")`.
- [ ] **Paso 4:** FAIL → implementar → PASS.
- [ ] **Paso 5:** commit `feat(admin): campañas: repositorio, validación e historial`.

### Tarea 4: rutas de la API

**Archivos:**
- Crear:
  - `apps/admin/src/app/api/admin/campanias/route.ts` (GET listado, POST alta)
  - `apps/admin/src/app/api/admin/campanias/[id]/route.ts` (GET, PUT, DELETE)
  - `apps/admin/src/app/api/admin/campanias/[id]/terminar/route.ts` (POST)
  - `apps/admin/src/app/api/admin/campanias/previsualizar/route.ts` (POST)
- Crear: `apps/admin/test/integration/campanias-rutas.integration.test.ts`

**Interfaces:**
- Consume `campanias-repo` (tarea 3).
- Copiar la guarda y el manejo de errores de `src/app/api/admin/precios-online/aplicar/route.ts`: `requireAdminPlus`, `PreciosOnlineError` → 409 con `{ error }`, validación → 400 con `{ error, errores }`.

Pasos:

- [ ] **Paso 1: tests.**
  - Un usuario sin admin+ recibe 403.
  - Un POST válido devuelve 201 con `{ id }`.
  - Un POST con choque de fechas devuelve 409.
  - PUT de una terminada devuelve 409.
  - DELETE de una programada devuelve 204.
  - POST `terminar` de una activa devuelve 200.
- [ ] **Paso 2:** FAIL → implementar → PASS.
- [ ] **Paso 3:** commit `feat(admin): campañas: rutas de la API`.

### Tarea 5: recalcular al cambiar categoría, marca o grupo

**Archivos:**
- Modificar: el repo que escribe `catalog_overlay.categoria_id` (buscar con `grep -rn "categoriaId" apps/admin/src/lib/catalogo-overlay-repo.ts`) y `recalcularGrupos` en `apps/admin/src/lib/catalogo-variantes-repo.ts`.
- Test: agregar casos a `apps/admin/test/integration/catalogo-overlay.integration.test.ts` y a `catalogo-variantes-manuales.integration.test.ts`.

**Interfaces:**
- Consume `aplicar_campanias_online(p_tenant, p_ids)`.
- Después de escribir, en la misma transacción, `SELECT aplicar_campanias_online($tenant, $ids)`. Los `$ids` son los productos tocados más todas las filas de su grupo. Si el código ya llama a `avisarShop`, no se duplica el aviso.

Pasos:

- [ ] **Paso 1: tests.**
  - Con una campaña al 20 % sobre la categoría C, asignar C a un producto le crea la entrada sin correr la sync. Sacarle la categoría la borra.
  - Sumar un producto a un grupo cuya ancla está en C le crea la entrada.
- [ ] **Paso 2:** FAIL → implementar → PASS.
- [ ] **Paso 3:** commit `feat(admin): campañas: recálculo al recategorizar o agrupar`.

### Tarea 6: solapa "Campañas" del catálogo

**Archivos:**
- Crear: `apps/admin/src/components/admin/catalogo/CampaniasPanel.tsx` (listado + formulario + vista previa)
- Crear: `apps/admin/src/components/admin/catalogo/campanias-ui.ts` (puro: formato de fechas en hora de Argentina, rótulos de estado, armado del cuerpo del POST) y su test
- Modificar: `apps/admin/src/components/admin/catalogo/CatalogoShell.tsx` (tab `"campanias"`, rótulo "Campañas", después de "Precios online")
- Modificar: la grilla de Precios online (`PreciosOnlinePanel.tsx`, solapa productos) para mostrar el indicador "En campaña" cuando `campanias_online` tiene una entrada activa
- Modificar: `apps/admin/docs/FUNCIONALIDADES.md` (sección Campañas)

**Interfaces:**
- Consume las rutas de la tarea 4.
- Para elegir productos reusar `BuscadorProducto`. Para marcas y categorías, los selectores de `ListasPrecioPanel`.

Cómo es la pantalla:

- **Listado:** nombre, ventana ("27/11 00:00 → 30/11 23:59"), estado (Programada / Activa / Terminada) y productos. Acciones según el estado.
- **Formulario:** nombre, etiqueta del badge, inicio y fin con fecha y hora (se interpretan como `-03:00`), y la tabla de reglas: alcance, objetivo, %, y unidades sólo para producto.
- **"Vista previa":** productos alcanzados, una muestra de normal → campaña por lista, y "N productos quedan por debajo del costo" resaltado.
  - El choque de fechas deshabilita "Guardar".
  - Si `bajoCosto > 0`, "Guardar" pide confirmar: "Hay N productos que quedarían por debajo del costo. ¿Desea guardar igual?".

Pasos:

- [ ] **Paso 1: tests de `campanias-ui.ts`.**
  - `aIsoArgentina("2026-11-27", "00:00")` → `"2026-11-27T00:00:00-03:00"`.
  - Rótulo de estado de cada caso.
  - El cuerpo del POST omite `unidades` vacías.
- [ ] **Paso 2:** FAIL → implementar → PASS.
- [ ] **Paso 3:** armar el panel y la solapa. Correr `npm run lint` y `npx tsc --noEmit` → sin errores nuevos.
- [ ] **Paso 4: verificación en el navegador** con `npm run dev` y la base local. Crear una campaña programada, verla en el listado, editarla, eliminarla. Crear una activa y terminarla. Revisar el texto de confirmación por debajo del costo.
- [ ] **Paso 5:** commit `feat(admin): solapa Campañas en el catálogo`.

---

## Parte 2: Shop, precios (PR 2, `apps/clientes`; requiere la migración del CRM aplicada)

### Tarea 7: contrato

**Archivos:**
- Modificar: `apps/clientes/src/db/crm.ts` (`crmCatalogo.campaniasOnline: jsonb("campanias_online")`; tabla nueva `crmCampanias` sobre `campanias_shop`)
- Modificar: `apps/clientes/src/db/__fixtures__/crm-contrato.json`
- Modificar: `owns/platform/contracts/` (el doc del contrato CRM↔Shop del catálogo), en otro commit en ese repo

**Interfaces:**
- Produce `crmCampanias` con columnas `tenantId`, `id`, `nombre`, `etiqueta`, `inicio` (timestamptz, modo string) y `fin`.

Pasos:

- [ ] **Paso 1:** correr el test del contrato existente (el que compara `crm.ts` con el fixture) → FAIL tras tocar `crm.ts`. Actualizar el fixture → PASS.
- [ ] **Paso 2:** commit `feat(clientes): contrato de campañas con el CRM`.

### Tarea 8: precio vigente (puro)

**Archivos:**
- Crear: `apps/clientes/src/lib/campanias/precio.ts` y `precio.test.ts`

**Interfaces:**
- Produce:

  ```ts
  export interface EntradaCampania {
    id: string; reglaId: string; inicio: string; fin: string;
    pct: number; unidades: number | null;
    precios: { idPriceList: string; price: number }[];
  }

  export interface ContextoCampania {
    activas: ReadonlySet<string>;
    /** Unidades que quedan por regla. Ausente = sin límite. */
    quedan?: ReadonlyMap<string, number>;
  }

  export interface PrecioResuelto {
    /** Neto que se cobra. */
    precio: number;
    /** Neto normal de referencia (lista del medio o general, o privado). */
    normal: number;
    /** null = no rige campaña. */
    campania: EntradaCampania | null;
    /** % que se exhibe; null sin campaña. */
    pct: number | null;
  }

  export function mapCampanias(raw: unknown): EntradaCampania[];

  export function resolverPrecioVigente(
    prices: AlegraPrice[],
    entradas: readonly EntradaCampania[] | undefined,
    ctx: ContextoCampania | undefined,
    opts?: { idListaMedio?: string; precioPrivado?: number | null },
  ): PrecioResuelto;
  ```

Reglas de `resolverPrecioVigente`:

- **Qué entrada rige:** la primera con `ctx.activas.has(id)` y que no esté agotada (`quedan.get(reglaId)` ausente o `> 0`).
- **Sin cuenta privada:**
  - `normal = precioDeLista(prices, idListaMedio)`;
  - la campaña es `precioDeLista` sobre `entrada.precios`, con el `main` copiado de `prices` por `idPriceList`;
  - `pct = entrada.pct`.
- **Con cuenta privada (`precioPrivado` es un número):**
  - la campaña es `precioGeneral` sobre los precios de campaña;
  - si ese precio es menor que el privado: `precio` = campaña, `normal` = privado, `pct = floor((1 − campaña / privado) × 100)`;
  - si no, no rige (`campania: null`).
- **`precioPrivado === null`:** nunca rige campaña; la línea queda "sin precio" como hoy.

Pasos:

- [ ] **Paso 1: tests.** Precios de ejemplo: main 160 y transferencia 130; campaña al 20 % con 128 y 104.
  - Activa sin medio → `{ precio: 128, normal: 160, pct: 20 }`.
  - Con `idListaMedio` = transferencia → `{ precio: 104, normal: 130, pct: 20 }`.
  - Id no activa → `{ precio: 160, campania: null }`.
  - Agotada (`quedan = 0`) → sin campaña.
  - Privado 140 → `{ precio: 128, normal: 140, pct: 8 }`.
  - Privado 120 → `{ precio: 120, campania: null }`.
  - `precioPrivado: null` → sin campaña.
  - `mapCampanias(null)` → `[]`; `mapCampanias` con un elemento roto lo ignora.
- [ ] **Paso 2:** FAIL → implementar → PASS.
- [ ] **Paso 3:** commit `feat(clientes): precio vigente con campañas`.

### Tarea 9: campañas vigentes por request

**Archivos:**
- Crear: `apps/clientes/src/lib/campanias/vigentes.ts` y su test
- Modificar: `apps/clientes/src/app/api/internal/catalogo/revalidar/route.ts`: no hace falta tocarlo si la lectura usa `TAG_CATALOGO`. Verificar con un test que el tag vence.

**Interfaces:**
- Produce:

  ```ts
  export interface CampaniaShop { id: string; nombre: string; etiqueta: string; inicio: string; fin: string }
  export interface CampaniaActiva { id: string; nombre: string; etiqueta: string; fin: string }

  export function idsActivasEn(campanias: readonly CampaniaShop[], fecha: Date): CampaniaActiva[]; // ordenadas por id
  export const campaniasVigentes: () => Promise<CampaniaActiva[]>;
  export function campaniasActivasEn(fecha: Date): Promise<CampaniaActiva[]>; // para recotizar pedidos
  ```

- `campaniasVigentes` va envuelto en `cache` de React, igual que `flagsPublicos`. Cómo funciona:
  - lee `crmCampanias` del tenant con una función interna `"use cache: remote"`, `cacheTag(TAG_CATALOGO)` y `cacheLife("catalogo")`;
  - aplica `idsActivasEn(…, new Date())` **afuera** de la caché;
  - si la lectura falla, devuelve `[]` y lo registra (degradar sin romper, como `leerMediosPrecio`).
- Leer el reloj fuera de la caché puede requerir `await connection()` según la versión de Next. Consultar `node_modules/next/dist/docs/` antes de escribirlo.

Pasos:

- [ ] **Paso 1: tests de `idsActivasEn` (foco 1).**
  - `fecha = inicio` → activa.
  - `fecha = fin − 1 ms` → activa.
  - `fecha = fin` → no.
  - Campaña terminada dentro de la gracia → no activa, aunque venga en la lista.
  - El orden por id es estable, porque va en la clave de la caché.
- [ ] **Paso 2:** FAIL → implementar → PASS.
- [ ] **Paso 3:** commit `feat(clientes): campañas vigentes por request`.

### Tarea 10: exhibición en catálogo y ficha

**Archivos:**
- Modificar: `apps/clientes/src/data/products.ts` (`Product.campania?: CampaniaProducto`)
- Modificar: `apps/clientes/src/lib/catalog.ts` (`mapFilaToProduct`, selección de `campaniasOnline` en `FilaCatalogo`)
- Modificar: `apps/clientes/src/lib/medios-precio.ts` (`armarPreciosMedios` recibe el contexto y usa el precio de campaña por lista)
- Modificar: `apps/clientes/src/lib/catalogo-publico.ts` (argumento `campanias: CampaniaActiva[]` en `ArgsPaginaPublica`, `productoCacheado` y las demás funciones que arman `Product`)
- Modificar: todos los llamadores (`app/catalogo/page.tsx`, `app/producto/[id]/page.tsx`, `app/api/shop/catalogo/route.ts`, `app/api/shop/variantes/route.ts`, `app/mi-cuenta/favoritos/page.tsx`, `app/buscar/route.ts`, `app/api/chat-ia/*`, home y marcas). Encontrarlos con `grep -rn "flagsPublicos()" apps/clientes/src/app`.
- Tests: `apps/clientes/src/lib/catalog.test.ts` (o el test existente de `mapFilaToProduct`) y `catalogo-publico.test.ts`

**Interfaces:**
- Consume `resolverPrecioVigente` y `mapCampanias` (tarea 8), y `campaniasVigentes` (tarea 9).
- Produce:

  ```ts
  export interface CampaniaProducto {
    id: string; nombre: string; etiqueta: string; fin: string; pct: number;
    unidades: number | null; quedan: number | null;
  }
  ```

- `mapFilaToProduct` recibe un parámetro nuevo `campanias?: { activas: CampaniaActiva[]; quedan?: ReadonlyMap<string, number> }`. Cuando rige una campaña:
  - `price` = precio de campaña;
  - `oldPrice` = `precioFinal(normal, iva)`;
  - `discount` = `"${pct} % de descuento"`;
  - `campania` armado con el nombre, la etiqueta y el fin de la `CampaniaActiva`.
- Las ids activas entran en la clave de la caché porque son argumento. `quedan` se calcula **adentro** de la función cacheada (tarea 16).

Pasos:

- [ ] **Paso 1: tests de `mapFilaToProduct`.**
  - Fila con campaña activa al 20 % e IVA 21 → `price` 128, `precioFinal` 154,88, `oldPrice` 193,60, `discount` "20 % de descuento", `campania.etiqueta` igual a la de la activa.
  - Sin activas → producto igual al de hoy (comparar con un snapshot del caso sin campaña).
  - La línea "$X con Transferencia" muestra 125,84, el final de 104.
- [ ] **Paso 2: test de clave en `catalogo-publico.test.ts`.** Dos llamadas con `campanias` distintas no comparten el valor cacheado; usar el mismo mecanismo que el test existente de `destacado`.
- [ ] **Paso 3:** FAIL → implementar → PASS. Correr `npm test` y `npx tsc --noEmit` → PASS.
- [ ] **Paso 4:** commit `feat(clientes): precio de campaña en catálogo y ficha`.

### Tarea 11: orden, filtro y rango de precio

**Archivos:**
- Modificar: `apps/clientes/src/lib/catalog.ts` (`precioSql`, `precioExhibidoSql` y sus usos en las líneas 1571-1574, 1712-1714 y 2137-2138; pasar las ids activas hasta ahí)
- Test: `apps/clientes/test/integration/orden-precio-campania.integration.test.ts` (nuevo)

**Interfaces:**
- Produce `precioVigenteSql(ids: readonly string[]): SQL<string>`. Es el precio general de campaña de la primera entrada de `campanias_online` cuyo `id` está en `ids`, o `precioSql` si no hay ninguna.

  ```sql
  coalesce(
    (select (pe->>'price')::numeric
     from jsonb_array_elements(coalesce(campanias_online, '[]')) e,
          jsonb_array_elements(e->'precios') pe
     where e->>'id' = any($ids)
       and pe->>'idPriceList' = <idPriceList del elemento main de precios_alegra>
     limit 1),
    <precioSql>)
  ```

- `precioExhibidoSql` pasa a ser una función `precioExhibidoSql(ids)`. Con `ids` vacío, el SQL generado es idéntico al de hoy.
- Limitación aceptada: el orden y el filtro no descuentan las unidades agotadas. Si se agota durante la campaña, el orden puede ubicarlo por el precio de campaña hasta que venza la caché.

Pasos:

- [ ] **Paso 1: test de integración.** Tres productos con precio normal 100, 150 y 200; el de 150 tiene campaña al 50 % (75).
  - Orden ascendente con la campaña activa → 75, 100, 200.
  - Filtro `precioMax` 95 (con IVA: el de campaña da 90,75 y el normal más barato 121) → incluye sólo el de campaña.
  - El rango del slider arranca en el mínimo de campaña.
  - Sin activas → 100, 150, 200.
- [ ] **Paso 2:** FAIL → implementar → PASS. `npm run test:integration` → PASS.
- [ ] **Paso 3:** commit `feat(clientes): orden y filtro por precio vigente`.

### Tarea 12: piezas visuales en cards, ficha, SEO y mini-carrito

**Archivos:**
- Modificar: `apps/clientes/src/components/promociones/PromoProvider.tsx` (nuevo `badgeCampania(c: CampaniaProducto): ReactNode`, con la misma forma visual que `badgePromo`)
- Modificar: `CatalogoProductos.tsx`, `TarjetaProductoCarrusel.tsx`, `favoritos/ProductoFavCard.tsx`
  - `badge = p.campania ? badgeCampania(p.campania) : (badgePromo(...) ?? badgeProducto(p))`
  - `oldPrice` y `discount` pasan a `ProductCard` (decisión A).
- Modificar: `ProductoClient.tsx`. Si hay `p.campania`, mostrar:
  - `PrecioPromo` con el normal tachado y "N % de descuento";
  - `CuentaRegresiva` variante `"pastilla"` hasta `p.campania.fin`. Al terminar, `router.refresh()`.
- Modificar: `apps/clientes/src/lib/producto-jsonld.ts` (`priceValidUntil` = `campania.fin` en `YYYY-MM-DD`)
- Modificar: `apps/clientes/src/components/CartPreview.tsx`. Hoy muestra `CartItem.price`; tiene que mostrar el precio de la última cotización de `/api/carrito/cotizar`, si existe, y la copia guardada sólo mientras no haya una.
- Tests: `promo-provider.test.tsx`, `promo-ficha.test.tsx` (o uno nuevo `ficha-campania.test.tsx`), `producto-jsonld.test.ts`

Pasos:

- [ ] **Paso 1: tests.**
  - `badgeCampania` muestra la etiqueta y "20 % de descuento" en verde (`text-success`), nunca en rojo.
  - La ficha con campaña muestra el tachado y la pastilla "Termina el 30/11".
  - El JSON-LD lleva `priceValidUntil: "2026-11-30"`.
  - Sin campaña, nada cambia.
- [ ] **Paso 2:** FAIL → implementar → PASS.
- [ ] **Paso 3: verificación en el navegador.** Con `preview_start` y la base local con una campaña activa, revisar:
  - catálogo, carrusel, ficha y búsqueda;
  - mobile 375 px: nada encima de las fotos;
  - consola sin errores de hidratación.
- [ ] **Paso 4:** commit `feat(clientes): badge, tachado y cuenta regresiva de campaña`.

### Tarea 13: cotización, pedido y recotización

**Archivos:**
- Crear: `apps/clientes/drizzle/00MM_order_items_campania.sql`. Agrega a `shop.order_items` las columnas `campania_id uuid`, `campania_regla_id uuid` y `precio_normal numeric(14,2)`, todas nullable y sin FK, porque son tablas del CRM.
- Modificar: `apps/clientes/src/db/schema.ts`
- Modificar: `apps/clientes/src/lib/cotizacion.ts`
  - `FilaEspejo.campanias`;
  - `itemDesdeEspejo` lleva `campanias`;
  - `leerEspejo` selecciona `crmCatalogo.campaniasOnline`;
  - `cotizar(pedidas, opts)` con `opts.campanias?: ContextoCampania`;
  - `cotizarItem(…, ctx?: ContextoCampania)` usa `resolverPrecioVigente`.
- Modificar: `LineaCotizada`. Agrega `precioNormal?: number`, `campaniaId?: string`, `campaniaReglaId?: string` y `campaniaEtiqueta?: string`.
- Modificar: `apps/clientes/src/lib/pedido-medio.ts` (`cotizarConMedio` acepta y pasa `campanias`)
- Modificar:
  - `app/api/carrito/cotizar/route.ts` y `app/api/pedidos/route.ts`: el contexto sale de `campaniasVigentes()`.
  - `app/api/pedidos/[id]/medio` y `/cuotas`: el contexto sale de `campaniasActivasEn(pedido.createdAt)`.
- Modificar: `apps/clientes/src/lib/pedidos.ts` (`crearPedido` congela las tres columnas)
- Modificar: el detalle del pedido en el CRM, que lee `order_items` y muestra "<etiqueta> −N %" en la línea. Buscar dónde lee `precio_unitario` con `grep -rn "precio_unitario\|precioUnitario" apps/admin/src/lib/*pedido*`. Si toca la lectura cruzada, agregar la columna al contrato inverso que use el CRM para `shop.order_items`.
- Tests: `cotizacion.test.ts`, y en integración `cambiar-medio-pedido.integration.test.ts` y `pedido-cuotas.integration.test.ts`

Pasos:

- [ ] **Paso 1: tests unitarios de `cotizarItem`.**
  - Con la campaña activa: `precioUnitario` 128, `precioNormal` 160, `campaniaId` puesto.
  - Sin contexto: igual que hoy.
- [ ] **Paso 2: test de integración (foco 4).**
  - Un pedido creado con la campaña activa y la campaña terminada en el CRM hace 10 minutos: `POST /api/pedidos/[id]/medio` a transferencia recotiza a 104 y no a 130.
  - Un pedido creado después del fin cotiza al normal.
  - `order_items` guarda `campania_id`, `campania_regla_id` y `precio_normal`.
- [ ] **Paso 3:** FAIL → escribir la migración y aplicarla a la base de test → implementar → PASS.
- [ ] **Paso 4:** commit `feat(clientes): cotización y pedido con precio de campaña`.

### Tarea 14: cuentas con lista privada

**Archivos:**
- Modificar:
  - `apps/clientes/src/lib/cotizacion.ts` (`cotizarItem` pasa `precioPrivado` a `resolverPrecioVigente`)
  - `apps/clientes/src/lib/precios-cuenta-estado.ts` (`aplicarEstadoPrecio`)
- Tests: `precios-cuenta-estado.test.ts`, `test/integration/listas-privadas.integration.test.ts`

Comportamiento de `aplicarEstadoPrecio` con `estado.tipo === "privado"`:

- **Si `p.campania` y `p.price < estado.precio.price`:** queda `price` = `p.price` (el de campaña de la lista general). Pasan a ser:
  - `oldPrice` = precio final del privado;
  - `discount` y `campania.pct` = `floor((1 − p.price / privado) × 100)`;
  - el badge se conserva.
- **Si no:** el comportamiento de hoy, y además `campania: undefined`, `badge: undefined` y `badgeText: undefined`.
- La ficha y las cards ya dibujan el badge desde `p.campania`: borrar `campania` alcanza para que no aparezca.

Pasos:

- [ ] **Paso 1: tests.**
  - Privado 140 con campaña 128 → `price` 128, tachado 169,40, "8 % de descuento".
  - Privado 120 con campaña 128 → `price` 120, sin `campania`.
  - Integración: el pedido de una cuenta privada cobra el menor.
- [ ] **Paso 2:** FAIL → implementar → PASS.
- [ ] **Paso 3:** commit `feat(clientes): campañas para cuentas con lista privada`.

### Tarea 15: carrito y checkout

**Archivos:**
- Modificar: `app/api/carrito/cotizar/route.ts` (las líneas devuelven `precioNormal` y `campaniaEtiqueta`)
- Modificar:
  - `components/CarritoClient.tsx` y `carrito-precios.ts`: la línea con el normal tachado y "Precio de <etiqueta>";
  - `components/CheckoutClient.tsx` (resumen): "Usted ahorra $X" en verde cuando la suma de `(precioNormal − precioUnitario) × qty`, con IVA, es mayor que 0.
- Tests: `carrito-precios.test.ts` y un test del resumen.

Pasos:

- [ ] **Paso 1: tests.**
  - Dos unidades a 128 con normal 160 e IVA 21 → "Usted ahorra $ 77,44".
  - Sin campaña → no aparece.
- [ ] **Paso 2:** FAIL → implementar → PASS.
- [ ] **Paso 3:** verificación en el navegador: agregar al carrito, ver el tachado, seguir al checkout y comprobar que el total coincide con el de la ficha.
- [ ] **Paso 4:** commit `feat(clientes): tachado y ahorro de campaña en carrito y checkout`.

---

## Parte 3: unidades y home (PR 2 o PR 3)

### Tarea 16: límite de unidades

**Archivos:**
- Crear: `apps/clientes/src/lib/campanias/unidades.ts`
- Modificar: `catalogo-publico.ts` y `catalog.ts`: dentro de la función cacheada se calcula `quedan` para las reglas con `unidades` de las campañas activas y se pasa a `mapFilaToProduct`.
- Modificar: `cotizacion.ts`: `cotizar` completa `ctx.quedan` y marca la línea.
- Modificar: `pedidos.ts`: validación en la transacción.
- Modificar: `app/api/pedidos/route.ts` (409)
- Modificar: `ProductoClient.tsx` (indicador "Quedan 3 de 5 a precio de <etiqueta>"; con `quedan ≤ 2`, "¡Últimas unidades!", reusando `UnidadesPromo`)
- Tests: `unidades.test.ts`; integración `test/integration/campania-unidades.integration.test.ts`

**Interfaces:**
- Produce:

  ```ts
  export async function unidadesUsadas(
    db: Lector, tenantId: string, reglaIds: readonly string[], excluirPedidoId?: string,
  ): Promise<Map<string, number>>;

  export function quedanDe(
    entradas: readonly EntradaCampania[], usadas: ReadonlyMap<string, number>,
  ): Map<string, number>; // unidades − usadas, mínimo 0, sólo reglas con límite

  export async function validarUnidadesEnTx(
    tx: Lector, tenantId: string, lineas: readonly LineaCotizada[],
  ): Promise<void>; // tira UnidadesCampaniaError

  export class UnidadesCampaniaError extends Error {
    constructor(readonly reglaId: string, readonly quedan: number, readonly ids: string[]);
  }
  ```

- Qué cuenta `unidadesUsadas`:
  - `sum(oi.qty)` de `shop.order_items oi JOIN shop.orders o` con `oi.campania_regla_id = ANY($ids)`;
  - `o.estado <> 'cancelado'`;
  - y además `(o.estado <> 'pendiente' OR o.pago_estado = 'pagado' OR coalesce(o.reserva_vence_en, o.created_at + interval '24 hours') > now())`;
  - `o.id <> $excluir` cuando se recotiza un pedido existente.
  - A diferencia de `stock_reservado`, **no** filtra `facturado_en`: un pedido facturado sigue contando.
- `validarUnidadesEnTx` va en `crearPedido` después de los dos caminos de bloqueo de stock y antes del `insert` de `order_items`. Toma `pg_advisory_xact_lock(hashtext('campania_regla:' || reglaId))` por cada regla con límite, en orden, y relee.
- `cotizarItem` marca la línea cuando `qty > quedan`:
  - `problema: "unidades_campania"`, con detalle "Quedan N unidades a precio de <etiqueta>. Reduzca la cantidad para mantener el precio.";
  - sumar `"unidades_campania"` a `ProblemaLinea`.
- `POST /api/pedidos` devuelve `409 { error: "unidades_campania", quedan, ids }`.

Pasos:

- [ ] **Paso 1: tests unitarios de `quedanDe`.**
  - Límite 5 con 3 usadas → 2.
  - 6 usadas → 0.
  - Sin límite → ausente del mapa.
- [ ] **Paso 2: integración (foco 5).**
  - Límite 1 y dos `crearPedido` simultáneos → uno se crea y el otro tira `UnidadesCampaniaError`.
  - Cancelar el primero → un pedido nuevo se crea.
  - Regla de modelo con límite 2: una unidad de la variante V1 y una de V2 → la tercera tira.
  - Con `quedan = 0`, la cotización cobra el precio normal (`campaniaId` ausente).
- [ ] **Paso 3:** FAIL → implementar → PASS.
- [ ] **Paso 4:** commit `feat(clientes): límite de unidades por campaña`.

### Tarea 17: la sección Promociones toma los datos de la campaña

**Archivos:**
- Modificar: `apps/clientes/src/lib/promociones/tipos.ts` (`PromocionesContent.campaniaId?: string`)
- Modificar: `promo.ts`. `datosPromoCliente` y `estadoPromo` usan `inicio`/`fin` de la campaña cuando `campaniaId` está y la campaña existe en `campanias_shop`.
- Modificar: `components/home/editores/EditorPromociones.tsx` y `promociones-editor.ts`:
  - selector "Campaña" (las de `campanias_shop`);
  - si hay una elegida, se ocultan inicio y fin;
  - se quitan los campos `precioHabitual`, `unidadesPromo` y `stockBase` del editor, aunque los tipos los siguen admitiendo para el contenido guardado.
- Modificar: `PromocionesVista.tsx` y `PromoFicha.tsx`:
  - si `Product.campania` existe, el precio, el tachado, el % y las unidades salen de ahí;
  - si no, el camino de hoy con `precioHabitual`, como compatibilidad.
- Tests: `editor-promociones.test.tsx`, `promociones-home.test.tsx`, `promo.test.ts`

Pasos:

- [ ] **Paso 1: tests.**
  - Sección asociada a la campaña C: las fechas salen de C.
  - Un item con `Product.campania` ignora `precioHabitual`.
  - Una estrella con regla de 5 unidades y 2 vendidas muestra "Quedan 3 de 5".
  - El editor ya no muestra "Precio habitual".
- [ ] **Paso 2:** FAIL → implementar → PASS.
- [ ] **Paso 3:** verificación en el navegador de la home en modo edición y en mobile.
- [ ] **Paso 4:** commit `feat(clientes): Promociones de la home toma precio y unidades de la campaña`.

---

## Orden de despliegue

1. **CRM.**
   1. Aplicar la migración del CRM en producción, parado en `apps/admin` de la rama del PR 1 y con `DATABASE_URL` explícita.
   2. Verificar con `SELECT count(*) FROM campanias_shop`.
   3. Mergear el PR 1.
2. **Shop.**
   1. Aplicar la migración del Shop.
   2. Mergear el PR 2 (y el 3, si va aparte).
   3. Actualizar el doc del contrato en `platform` en el mismo momento.
3. **Promo de lanzamiento.**
   1. Crear su campaña, con el % equivalente y las unidades de la estrella.
   2. Asociarla a la sección.
   3. Borrar los ajustes por producto que se habían cargado para la promo en Precios online.
