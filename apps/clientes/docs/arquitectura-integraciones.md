# Arquitectura de integraciones — Shop, CRM y Alegra

> Decisión de arquitectura. Define de dónde sale cada dato y quién es dueño de
> cada concepto. Leer antes de conectar el shop con cualquier sistema externo.

_Última actualización: 2026-09-25 (retiro de la sync y de las tablas del catálogo del Shop). Las
secciones sobre bases separadas son anteriores a la decisión de 2026-09-20
(monorepo y una sola base; ver el `AGENTS.md` de la raíz)._

## Los tres sistemas

| Sistema | Propiedad | Rol |
|---|---|---|
| **Alegra** | Externo (SaaS) | **Sistema de record**: clientes, productos, precios, stock, facturas, contabilidad. Reemplazó a Flexxus. Solo se toca por su **API REST**. |
| **CRM** | Propio (repo aparte, **DB propia**) | Relación con el cliente: crédito, estado de cuenta, reglas de negocio, seguimiento. |
| **Shop** | Propio (**este repo**, **DB propia**) | Catálogo + armado de pedido. Guarda solo su "delta" (carrito, fotos web, borradores, OTP). |

Los tres tienen **bases de datos separadas**. La integración es **siempre por API
(contrato), nunca por DB compartida** — ni siquiera entre CRM y Shop, aunque
ambos sean propios. Compartir DB los acopla para siempre; separarlos hoy es
barato, desacoplarlos después es caro.

El Shop y el CRM ya comparten la **sesión** vía cookie en `.cliente.example`
(ver `src/lib/session.ts`). Eso es SSO por cookie, no acceso a datos.

## Regla de ruteo

> Se rutea a través del CRM cuando el CRM **aporta lógica propia**.
> Se va **directo a Alegra** cuando el CRM sería un **mero pasamanos**
> (solo agregaría latencia y otra dependencia).

El criterio no es "todo por el CRM" ni "todo directo a Alegra": es **quién es
dueño del concepto**.

## Dueño de cada dato

| Dato | Dueño del concepto | Ruta desde el Shop |
|---|---|---|
| Catálogo, precios, stock | Alegra (dato crudo), espejado por el CRM | **Vistas del CRM** en la base compartida (ver "Catálogo: el Shop lo lee del CRM") |
| Facturas / PDF | Alegra (documento) | **Directo a Alegra** (o Portal) |
| Saldo, deudas, límite de crédito, "¿puede comprar a cuenta?" | **CRM** (relación con el cliente) | **Se pregunta al CRM** |

Punto clave: **saldo/deudas/crédito son conceptos del CRM, no del Shop**. El
límite de crédito probablemente ni exista en Alegra — es un campo del CRM. El CRM
combina el saldo que trae de Alegra con **sus propias reglas** (ej. "bloquear si
tiene vencidos > 30 días", "límite $X") y entrega un **veredicto**, no números
crudos. **El Shop nunca calcula nada financiero.**

## Diagrama

```
                ALEGRA  (productos · precios · stock · facturas)
               /       \
  catálogo,  /         \  contactos /
  stock,    /           \  facturas
  cuenta   ▼             ▼  (directo)
        ┌────────┐  vistas del catálogo   ┌────────┐
        │  CRM   │───────────────────────►│  SHOP  │
        └────────┘◄───────────────────────└────────┘
                          ask
```

## Catálogo: el Shop lo lee del CRM (una copia, un cron)

**Decisión vigente (2026-09-24, change `catalogo-shop-desde-crm`).** El Shop
**no tiene copia propia del catálogo**. Lee TODO el producto (nombre,
descripción, código, marca, categoría de Alegra, IVA, precios, stock y estado)
de dos vistas del CRM en la base compartida:

- `public.catalog_products_shop` → `crmCatalogo` en `src/db/crm.ts`;
- `public.catalog_categories_shop` → `crmCategoriasAlegra`.

Las mantiene el CRM con **su** sync diaria (GitHub Actions,
`admin-alegra-sync`) y con los webhooks de Alegra: un cambio de nombre, stock o
precio llega a la tienda en minutos. Hay **una** sync por cuenta de Alegra.

Reglas del lado del Shop:

- Las vistas son de todos los tenants. Toda consulta del catálogo tiene de base
  `crmCatalogo` con `tenant_id = SHOP_TENANT_ID` en el WHERE
  (`enTenantCatalogo`), y el join a categorías lleva el tenant en el ON
  (`joinCategoriasAlegra`), ver `src/lib/catalogo-fuente.ts`. Lo exige
  `src/lib/catalogo-tenant.test.ts`.
- IVA = `iva_porcentaje` de la vista: la SUMA de los impuestos del ítem en
  Alegra (regla única del CRM). Precios = `precios_alegra` crudos, normalizados
  con `mapPrecios`. Marca = `brand` (regla del CRM) o, si viene vacía, el nombre
  de la categoría de Alegra.
- El stock que se muestra y se valida es el disponible: el de la vista menos lo
  reservado por pedidos vivos del Shop (`shop.stock_reservado`).
- Ficha, carrito, checkout y pedido usan la misma vista: valen los precios que
  publica la tienda, sin llamadas a Alegra en el request (decisión 2026-09-23).
- `shop_app` sólo tiene `SELECT` sobre las vistas (no ve `raw` ni costos). El
  contrato de columnas está en `src/db/__fixtures__/crm-contrato.json`.

### Caché de datos del catálogo y de las cuotas

Las páginas son un shell estático (Cache Components) con huecos por request.
Los huecos que leen el catálogo público no van a la base en cada vista: leen de
`'use cache: remote'` (Runtime Cache de Vercel, compartida entre instancias).

| Qué | Dónde | Tag | Perfil (`next.config.ts`) |
|---|---|---|---|
| Contenido de la home, anuncio, footer, datos legales | `src/lib/home-datos.ts` (`'use cache'`, en el shell) | `home` | `home` |
| Página y facetas del catálogo, ficha, categorías del nav, destacados de la home | `src/lib/catalogo-publico.ts` | `catalogo` | `catalogo`: stale 60 s, revalidate 10 min, **expire 15 min** |
| Oferta de cuotas de listados y fichas | `src/lib/cuotas-datos.ts` (`ofertaCuotasCacheada`) | `cuotas` | `cuotas`: stale 5 min, revalidate 15 min, expire 1 h |
| Rama de error (vacío o defaults) de cualquiera | — | el mismo | `degradado`: expire 5 min |

Quién invalida:

- **Catálogo** → `POST /api/internal/catalogo/revalidar` (Bearer
  `SHOP_CRM_SECRET`, sin payload, responde `{ ok: true }`):
  `revalidateTag('catalogo', { expire: 0 })`. Lo llama el CRM al terminar la
  sync de Alegra, al drenar webhooks de stock con cambios y al guardar overlay
  o categorías. Si el aviso se pierde, el perfil vence solo a los 15 minutos.
- **Pedidos del Shop** (crear y cancelar) reservan o liberan stock:
  `revalidateTag('catalogo', 'max')` (la próxima vista renueva en segundo
  plano).
- **Cuotas** → el ping del CRM (`/api/internal/cuotas/revalidar`) y el cron
  (`/api/cron/cuotas-sync`): `revalidateTag('cuotas', { expire: 0 })`.
- **Home** → el editor (server actions): `updateTag('home')`.

Reglas:

- En la caché sólo entra lo que es igual para todos (precio de la lista
  principal, stock disponible, curaduría). Nada del visitante: ni identidad,
  ni lista de precios del cliente, ni favoritos.
- Los flags públicos (`catalogo-solo-visibles`, `cuotas`) se evalúan por
  request (`src/lib/flags-publicos.ts`) y viajan como argumento: son parte de
  la clave.
- Búsqueda por texto y rango de precio no se cachean (demasiados valores
  distintos).
- **Carrito, cotización, checkout, pedido y Mi cuenta no leen de estas
  cachés**: cotizan del espejo en vivo (`src/lib/cotizacion.ts`,
  `getOfertaCuotasSinCache`, `getOfertaCuotasParaPedido`). Un listado unos
  segundos atrasado nunca cambia lo que se cobra.
- Cada función cacheada loguea `[cache] <nombre> miss` cuando corre: en los
  logs de Vercel, una vista sin `miss` salió de la caché.
- Guardas: `src/cache-guardas.test.ts`.
- Plan B si la cuota de Runtime Cache del plan no alcanza: cambiar
  `'use cache: remote'` por `'use cache'` en `catalogo-publico.ts` y
  `cuotas-datos.ts` (sigue correcto; baja el acierto entre instancias).

**Retiro de la copia propia.** La sync propia del Shop (script, módulo, ruta de
cron y workflow de GitHub Actions) se borró, y sus tablas (`catalog_products`, `catalog_categories`, `catalog_sync_log` del esquema
`shop`) se dropean con la migración 0015 del Shop. Una guarda estática
(`src/lib/sin-espejo-shop.test.ts`) impide que vuelvan.

**Historial.** Del 2026-07-29 al 2026-09-24 el Shop mantuvo su propia copia del
catálogo, sincronizada contra Alegra, para no colgar la vidriera del CRM. Se
dejó de lado al pasar las dos apps a una sola base (decisión 2026-09-20): con el
CRM en la misma base, la copia sólo agregaba drift, un segundo cron contra la
misma cuenta de Alegra y dos reglas distintas de IVA y marca.

## Contrato: estado de cuenta del cliente

Cuando el Shop necesita datos financieros (ej. validar crédito en un checkout a
cuenta corriente), **no toca facturas de Alegra**: le pregunta al CRM.

```
GET {CRM}/api/clientes/:id/estado-cuenta
→ {
    "puedeComprarACuenta": true,
    "saldo": 152000,
    "vencidos": 0,
    "limiteDisponible": 300000
  }
```

El Shop solo **muestra** eso o **decide** en base a `puedeComprarACuenta`. Toda
la lógica financiera vive en un único lugar (el CRM), consistente con lo que ve
el CRM mismo. Prerrequisito: el CRM debe exponer ese endpoint (decisión del lado
del CRM; no bloquea al Shop).

## Consecuencias para este repo

1. **`src/lib/alegra.ts` integra Alegra solo para catálogo / precios / stock /
   facturas.** No arma saldos ni cuenta corriente.
   - El Shop ya no pagina el catálogo de Alegra: lo lee de las vistas del CRM
     (ver "Catálogo: el Shop lo lee del CRM").
2. **No hay helper de cuenta corriente en el Shop.** Lo financiero es un endpoint
   del CRM que se consume si/cuando el checkout valide crédito.
3. **Escalas de precio por cantidad**: Alegra no las soporta nativamente. Si el
   negocio las necesita, se resuelven en la DB del Shop — no en Alegra.

## Historial

- **Flexxus quedó descartado**: todo su rol lo absorbió Alegra. Los planes en
  `docs/superpowers/plans/` fueron escritos contra Flexxus; la capa de datos se
  migra a Alegra (`src/lib/flexxus.ts` → `src/lib/alegra.ts`), pero el resto de
  la arquitectura (auth OTP, sesión, route groups, componentes) se mantiene.
