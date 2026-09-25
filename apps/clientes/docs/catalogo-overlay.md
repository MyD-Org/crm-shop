# Overlay del catálogo: qué lee el Shop

> Sin datos reales: los hosts de ejemplo usan el dominio reservado
> `.example` (`media.plataforma.example`). Nunca pegue en el repo, en un PR ni
> en un issue un host o una URL de producción.

El admin del CRM cura el catálogo (nombre comercial, fotos, visibilidad,
taxonomía propia) y el Shop lo lee **directo de las tablas del CRM**
(`public.catalog_overlay` y `public.shop_categories`, filtradas por
`SHOP_TENANT_ID`): las dos apps comparten base, así que no hay copia ni sync
por HTTP. Las definiciones de lectura están en `src/db/crm.ts`, fuera de
`schema.ts` para que las migraciones del Shop no las toquen. El overlay es
**esparso**: sólo hay fila para los productos que alguien tocó en el CRM.

La copia vieja (`shop.catalog_overlay`, `shop.shop_categories`,
`shop.shop_tags` y `shop.catalogo_sync_state`) se borra con la migración
`0004_borrar_copia_catalogo`.

El rol de runtime (`shop_app`) necesita `SELECT` sobre las dos tablas del CRM
(ver "Lectura directa del catálogo del CRM" en
[`una-base-esquema-shop.md`](./una-base-esquema-shop.md)).

## Qué se lee hoy

Todas las lecturas públicas del espejo (`getCatalogo`, conteo y página de
`getPaginaCatalogo`, las consultas de `getFacetas`) hacen `left join` a
`public.catalog_overlay` por `alegra_id` y tenant.

Categorías: si el tenant armó su árbol en el admin, el menú (raíces), las
facetas (árbol completo, con las subcategorías sangradas) y el filtro
(`?categoria=`, que incluye el subárbol) salen de `public.shop_categories`, y
un producto cae en la categoría que le asignaron en el overlay. Sin árbol, todo
sigue con las categorías de Alegra.

| Dato del Shop | De dónde sale |
|---|---|
| Nombre exhibido | `overlay.nombre` → si está vacío, `description` de Alegra → si también, `name` de Alegra (en esta cuenta es el código). |
| SKU (`Cód.`) | `code` (reference de Alegra) → si falta, `name` de Alegra. |
| Fotos (`images`, portada = la primera) | `overlay.fotos`: el CRM guarda la key de R2 y la URL se compone con `R2_SHOP_MEDIA_PUBLIC_URL` (la misma base que usa el CRM). Sólo pasan las `https` de un host listado en `SHOP_MEDIA_HOSTS`. Sin fotos servibles, la card muestra el placeholder. |
| Visibilidad | `overlay.visible`, **sólo** con el flag `catalogo-solo-visibles` prendido (ver abajo). |

La ficha de producto (`getProducto`) sale de la misma vista y del mismo
overlay que la card del catálogo (nada del tráfico público llama a Alegra).

**Caché.** Listado, facetas, ficha, nav y destacados se leen de una caché
compartida con el tag `catalogo` (`src/lib/catalogo-publico.ts`). Un cambio en
el overlay o en las categorías se ve en la visita siguiente porque el CRM
avisa a `/api/internal/catalogo/revalidar`; si el aviso se pierde, a los 15
minutos como máximo. Ver "Caché de datos del catálogo y de las cuotas" en
[`arquitectura-integraciones.md`](./arquitectura-integraciones.md).

## Flag `catalogo-solo-visibles` (apagado por defecto)

- Vive en Vercel Flags. Apagado (o si Vercel Flags no responde), el catálogo
  se comporta como antes (sin condición de visibilidad).
- Se evalúa por request y viaja como argumento a las lecturas cacheadas (es
  parte de la clave): prenderlo o apagarlo se ve en la vista siguiente, sin
  esperar a que venza la caché.
- Encendido, el catálogo, las facetas, la home y el autocompletado exigen
  `catalog_overlay.visible = true`.
- **Es fail-closed.** `visible` arranca en `false` y un producto sin fila de
  overlay queda afuera. Encenderlo antes de curar el catálogo en el admin del
  CRM **deja la tienda vacía**.

### Criterio de encendido

Lo enciende quien administra el catálogo, **después** de publicar en el admin
del CRM los productos que se quieren vender. Antes de encenderlo, compare en la
base del entorno (parado en una consola SQL con permisos de lectura):

```sql
select count(*) from public.catalog_overlay where tenant_id = '<TENANT_SLUG>' and visible;
select count(*) from public.catalog_products_shop where tenant_id = '<TENANT_SLUG>' and activo;
```

El primer número tiene que ser el que el negocio quiere publicar (no cero, y
coherente con el segundo). Recién ahí:

1. En Vercel Flags (proyecto Shop), prenda `catalogo-solo-visibles` en el
   entorno que corresponda (`vercel flags enable catalogo-solo-visibles
   --environment production`). No hace falta redesplegar.
2. Humo: `/catalogo` lista productos, la búsqueda del header encuentra alguno
   publicado y uno no publicado ya no aparece.

Rollback: apague el flag (`vercel flags disable ...`).

## `SHOP_MEDIA_HOSTS`

- Hosts de las fotos del overlay, separados por coma. Ejemplo:
  `SHOP_MEDIA_HOSTS=media.plataforma.example`.
- La misma lista alimenta `images.remotePatterns` de `next.config.ts` (sólo
  `https`, cualquier ruta). `next/image` responde 400 a un host que no esté
  listado; por eso el Shop descarta en el servidor las fotos de hosts no
  configurados y la card muestra el placeholder en su lugar.
- Obligatoria en todo entorno donde haya fotos cargadas en el CRM (Vercel y el
  entorno local). Se lee en el build (`remotePatterns`) y en runtime (filtro de
  fotos): un cambio requiere redesplegar.

## Qué sigue (fuera de este cambio)

`orden` del
overlay, `overlay.descripcion` en la ficha, lectura del overlay en la ficha en
vivo, búsqueda por `overlay.nombre` y redirects: quedan para el cambio
`catalogo-shop` (F3).
