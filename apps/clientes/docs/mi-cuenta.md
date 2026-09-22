# Mi cuenta

Área del cliente del Shop: pedidos, datos, direcciones y envíos, organizada
por secciones sobre el design system (`@myd-org/ui` ≥ 0.13). Este documento
se completa con las rebanadas de favoritos y facturas.

## Rutas

Todas cuelgan de `src/app/mi-cuenta/layout.tsx`, que pinta el shell
(`MiCuentaShell`: breadcrumb, saludo y navegación de secciones). Cada página es
dinámica (`force-dynamic`) y, sin identidad, redirige a
`/ingresar?redirect_url=<su ruta exacta>`.

| Ruta | Qué muestra |
|---|---|
| `/mi-cuenta` | Resumen: tarjetas "Pedidos en curso" y "Productos en el carrito", y los últimos 3 pedidos con "Ver todos". Ninguna llamada a Alegra. |
| `/mi-cuenta/pedidos` | Todos los pedidos (los 50 más recientes). |
| `/mi-cuenta/pedidos/[id]` | Detalle: seguimiento, entrega, pago, productos y totales. Un id ajeno o que no es uuid da 404 (nunca 403). |
| `/mi-cuenta/datos` | Datos de acceso (panel de Clerk), datos de facturación (`FacturacionForm`, bloqueado si la cuenta está vinculada), cuenta de cliente y, sólo con cuenta corriente, el portal del CRM. |
| `/mi-cuenta/direcciones` | Domicilio de facturación en sólo lectura y un estado vacío honesto para la entrega. |
| `/mi-cuenta/envios` | Envío a domicilio y retiro, derivado de `src/lib/envio.ts`. |
| `/mi-cuenta/vincular` | Vinculación con la cuenta de cliente de Alegra (`VincularClient`). |

"Seguridad" y "Cerrar sesión" no son rutas: son acciones de la navegación
(`openUserProfile` y `signOut` de Clerk). `/mi-cuenta/seguridad` da 404.

Favoritos (`/mi-cuenta/favoritos`) y Facturas (`/mi-cuenta/facturas`) todavía
no existen: dan 404 y no aparecen en la navegación ni en el menú del header.

### Breadcrumb

Slot paralelo `src/app/mi-cuenta/@migas/`: `page.tsx` (resumen),
`[...ruta]/page.tsx` (cualquier sección, con `migasMiCuenta`) y
`pedidos/[id]/page.tsx`, que suma el número del pedido con el mismo
`getPedido` en `cache()` que usa la página (una consulta; sin identidad no
consulta). `default.tsx` devuelve `null`. El `<nav>` se llama "Migas de pan"
para no confundirse con "Secciones de su cuenta".

## Redirects

En `next.config.ts` (reglas en `src/lib/mi-cuenta-redirects.ts`). Se evalúan
antes que el filesystem: no se renderiza nada ni se resuelve la identidad.

| Desde | Hacia | Código |
|---|---|---|
| `/mi-cuenta?tab=datos` | `/mi-cuenta/datos` | 307 (temporal) |
| `/mi-cuenta/pedido/:id` | `/mi-cuenta/pedidos/:id` | 308 (permanente) |

Cualquier otro `?tab=` muestra el resumen. Next pasa la query al destino
(`/mi-cuenta/datos?tab=datos`), que la ignora.

## Identidades y capacidades

`src/lib/mi-cuenta-nav.ts` decide qué secciones ve cada identidad; la UI sólo
marca la activa.

| Identidad | Secciones |
|---|---|
| Anónimo | Ninguna: redirect al ingreso. |
| Cookie heredada del CRM, sin Clerk | Pedidos, Envíos y retiro (+ Facturas cuando exista). `/datos` pide iniciar sesión; `/direcciones` sólo muestra el estado vacío. |
| Clerk sin cuenta vinculada | Pedidos, Direcciones, Envíos y retiro, Mis datos, Seguridad, Cerrar sesión. |
| Clerk con cuenta vinculada | Igual, con facturación bloqueada y, si es cuenta corriente, el portal. |

`CAPACIDADES_DESPLIEGUE` (`{ favoritos, facturas }`, hoy ambos en `false`)
enciende cada sección cuando su rebanada la publica: navegación y menú del
header leen la misma bandera.

## Estado y seguimiento del pedido

- **Una sola pill** (`src/lib/estado-pedido-pill.ts`): cancelado → pago
  rechazado → pago pendiente → pago confirmado → estado. Con los pagos apagados
  (`PAGOS_ENABLED` distinto de `1`) un pedido pendiente dice "Pendiente" y no
  "Pago pendiente": el pago se coordina por fuera.
- **Seguimiento** (`src/lib/pedido-seguimiento.ts`): proyección de estado ×
  pago × tipo de entrega. Retiro: Pedido recibido → Pago confirmado →
  Preparando → Retirado. Envío: … → Preparando → En camino → Entregado.
  "Pago confirmado" también se da por hecho si el operador ya confirmó (cobro
  offline). Un cancelado no tiene seguimiento.
- **No existe "Listo para retiro"**: el CRM no tiene ese estado. Cuando exista
  (follow-up `pedidos-listo-retiro`) se agrega el paso en la proyección; el
  `Stepper` del DS no cambia.
- Las líneas muestran el nombre real y la foto del espejo del catálogo
  (`getProductosPorIds`, sin filtro de visibilidad): un producto despublicado
  sigue mostrando su nombre en un pedido viejo.

## Componentes: servidor y cliente

`@myd-org/ui` se publica con `"use client"`. Un componente de servidor puede
renderizar `Card`, `Badge`, `Stepper`, `EmptyState` o `Alert` con props
serializables; todo lo que le pase una función al DS (`renderLink`,
`onSelect`, `onClick`) o use hooks (`useCart`, `useClerk`, `usePathname`)
lleva `"use client"`. Para un enlace con aspecto de botón desde una página de
servidor está `BotonEnlace` (`Button` con `href` + `next/link`).

## Guarda anti-literales

`src/components/mi-cuenta/sin-literales.test.ts` lee como texto
`src/components/mi-cuenta/**`, `src/app/mi-cuenta/**` (y `BotonFavorito.tsx`
cuando exista) y falla ante valores arbitrarios (`[16rem]`), `clamp(`,
colores de la paleta o literales, overrides `[&_…]`, `style={}` o constantes
de clases; también ante voseo o tuteo en el texto y ante un `<h1>` fuera del
shell. Lo que el DS no tenga se agrega al DS, no como excepción.

## Follow-ups

- `pedidos-listo-retiro` (cross-repo): estado nuevo en el CRM y paso en el
  seguimiento.
- `pedidos-factura-vinculada` (cross-repo): guardar la factura del pedido para
  mostrar "Descargar factura" en la card.
- `direcciones-envio`: direcciones de entrega guardadas y precarga en el
  checkout.
- Congelar el nombre real del producto en `order_items` al crear el pedido.
- DS: `Alert` con tono `info` (hoy "Envíos y retiro" usa `neutral`).
