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

Las tablas `shop.catalog_overlay`, `shop.shop_categories`, `shop.shop_tags` y
`shop.catalogo_sync_state` son la copia vieja: ya no se leen ni se escriben y
quedan para borrarlas con una migración aparte.

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
| Visibilidad | `overlay.visible`, **sólo** con `SHOP_CATALOGO_SOLO_VISIBLES=1` (ver abajo). |

La ficha de producto (`getProducto`) es en vivo contra Alegra y no lee el
overlay: muestra `description || name` como nombre, igual que la card de un
producto sin overlay.

## `SHOP_CATALOGO_SOLO_VISIBLES` (apagado por defecto)

- Sólo el valor `1` lo enciende. Cualquier otro valor, o la variable ausente,
  lo deja apagado: el catálogo se comporta como antes (sin condición de
  visibilidad).
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
select count(*) from shop.catalog_overlay where visible;
select count(*) from shop.catalog_products where status = 'active';
```

El primer número tiene que ser el que el negocio quiere publicar (no cero, y
coherente con el segundo). Recién ahí:

1. En Vercel (proyecto Shop), cree `SHOP_CATALOGO_SOLO_VISIBLES=1` en el
   entorno que corresponda.
2. Redespliegue (las variables se leen al arrancar las funciones).
3. Humo: `/catalogo` lista productos, la búsqueda del header encuentra alguno
   publicado y uno no publicado ya no aparece.

Rollback: borre la variable y redespliegue.

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
