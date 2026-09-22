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
| `/mi-cuenta` | Resumen: tarjetas "Pedidos en curso", "Productos en el carrito" y (con Clerk) "Favoritos guardados"; los últimos 3 pedidos y (con Clerk) los 4 favoritos más recientes, cada uno con "Ver todos". Ninguna llamada a Alegra. |
| `/mi-cuenta/pedidos` | Todos los pedidos (los 50 más recientes). |
| `/mi-cuenta/pedidos/[id]` | Detalle: seguimiento, entrega, pago, productos y totales. Un id ajeno o que no es uuid da 404 (nunca 403). |
| `/mi-cuenta/datos` | Datos de acceso (panel de Clerk), datos de facturación (`FacturacionForm`, bloqueado si la cuenta está vinculada), cuenta de cliente y, sólo con cuenta corriente, el portal del CRM. |
| `/mi-cuenta/direcciones` | Direcciones y envíos: domicilio de facturación en sólo lectura (con Clerk), envío a domicilio y retiro derivados de `src/lib/envio.ts`, y el aviso de que la entrega se indica en cada compra. |
| `/mi-cuenta/envios` | Redirige (308) a `/mi-cuenta/direcciones`: Envíos y retiro se unió a Direcciones. |
| `/mi-cuenta/favoritos` | Favoritos del usuario de Clerk en cards compactas (ver [Favoritos](#favoritos)). |
| `/mi-cuenta/vincular` | Vinculación con la cuenta de cliente de Alegra (`VincularClient`). |

"Seguridad" y "Cerrar sesión" no son rutas: son acciones de la navegación
(`openUserProfile` y `signOut` de Clerk). `/mi-cuenta/seguridad` da 404.

Facturas (`/mi-cuenta/facturas`) todavía no existe: da 404 y no aparece en la
navegación.

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
| Cookie heredada del CRM, sin Clerk | Pedidos, Direcciones y envíos (+ Facturas cuando exista). `/datos` pide iniciar sesión; en `/direcciones` no aparece el domicilio de facturación, sólo las reglas de envío. |
| Clerk sin cuenta vinculada | Pedidos, Favoritos, Direcciones y envíos, Mis datos, Seguridad, Cerrar sesión. |
| Clerk con cuenta vinculada | Igual, con facturación bloqueada y, si es cuenta corriente, el portal. |

`CAPACIDADES_DESPLIEGUE` (`{ favoritos, facturas }`) enciende cada sección
cuando su rebanada la publica: navegación y menú del header leen la misma
bandera. `favoritos` está encendida.

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

## Favoritos

Guardados por usuario de Clerk. Quien entra sólo con la cookie del CRM no
tiene dónde guardarlos: no ve el corazón y `/mi-cuenta/favoritos` le pide
iniciar sesión.

**Tabla** `shop.favorites` (migración `0002_favoritos`): `tenant_id`,
`clerk_user_id`, `alegra_item_id`, `created_at`. Unique por
(tenant, usuario, ítem), que hace idempotente el alta, e índice por
(tenant, usuario, fecha) para el "más nuevo primero". Sin FK a
`catalog_products` (el espejo lo reescribe la sync) ni a `public`. Aplicarla a
mano en producción **antes** de desplegar: ver el runbook en
[`una-base-esquema-shop.md`](./una-base-esquema-shop.md#migraciones-posteriores-a-la-baseline).

**Servidor** (`src/lib/favoritos.ts`): toda consulta filtra por el tenant del
entorno y el usuario. Tope de **200** por usuario: un ítem nuevo por encima
lanza `FavoritosLlenosError`; volver a guardar uno existente no falla. La
lista sale del espejo del catálogo con el precio de la lista del cliente y sin
filtro de visibilidad; los ids que el espejo ya no tiene se omiten, así que la
lista puede tener menos productos que filas (el contador cuenta filas).

**API** `/api/mi-cuenta/favoritos` (dinámica, `Cache-Control: private,
no-store`, sólo Clerk):

| Método | Body | Respuesta |
|---|---|---|
| `GET` | — | `200 { ids }` del más nuevo al más viejo |
| `PUT` | `{ alegraItemId }` | `200 { ok: true }` (idempotente) |
| `DELETE` | `{ alegraItemId }` | `200 { ok: true }` (idempotente) |

Errores: `401 { error: "No autorizado" }` sin sesión de Clerk; `400 { error:
"Indique el producto." }` si el id falta, no es string o pasa de 64
caracteres; `422 { error: "Alcanzó el máximo de 200 favoritos." }`; `429`
pasadas 60 solicitudes por minuto por usuario (`favoritos:clerk:<id>`, en
memoria de la instancia como el resto de `rate-limit.ts`).

**Cliente**: `FavoritosProvider` (`src/context/FavoritosContext.tsx`, dentro de
`Providers`) hace un GET al montar con sesión y expone `ready`, `disponible`,
`count`, `esFavorito` y `toggle`. El toggle es optimista: si la API falla,
revierte y muestra un toast en usted; un 401 revierte y abre el ingreso.
Anónimo: el corazón abre el modal de Clerk y no llama a la API (no se recuerda
el intento). `src/app/layout.tsx` le pasa `favoritosBloqueados` (cookie del CRM
sin Clerk), resuelto con `identidadActual()` en `cache()`. La lógica pura está
en `src/lib/favoritos-cliente.ts`.

**Corazón** (`BotonFavorito`, `ToggleIconButton` del DS): en
`ProductCard.cornerAction` del catálogo y de la home (ahí con `dentroDeLink`,
porque la card está envuelta en un `<Link>`), en la ficha junto a "Agregar al
carrito" y en las cards de favoritos. Neutro y `aria-disabled` hasta `ready`.

## Componentes: servidor y cliente

`@myd-org/ui` se publica con `"use client"`. Un componente de servidor puede
renderizar `Card`, `Badge`, `Stepper`, `EmptyState` o `Alert` con props
serializables; todo lo que le pase una función al DS (`renderLink`,
`onSelect`, `onClick`) o use hooks (`useCart`, `useClerk`, `usePathname`)
lleva `"use client"`. Para un enlace con aspecto de botón desde una página de
servidor está `BotonEnlace` (`Button` con `href` + `next/link`).

## Guarda anti-literales

`src/components/mi-cuenta/sin-literales.test.ts` lee como texto
`src/components/mi-cuenta/**`, `src/app/mi-cuenta/**` y
`src/components/BotonFavorito.tsx`, y falla ante valores arbitrarios (`[16rem]`), `clamp(`,
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
- Favoritos de anónimos guardados en el navegador y fusionados al ingresar.
- DS: `Alert` con tono `info` (hoy "Direcciones y envíos" usa `neutral`).
