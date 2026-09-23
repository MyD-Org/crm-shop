# Mi cuenta

Área del cliente del Shop: pedidos, datos, favoritos, direcciones y envíos,
organizada por secciones sobre el design system (`@myd-org/ui` ≥ 0.13).

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
| `/mi-cuenta/datos` | Datos personales (nombre y correo de Clerk, en lectura; "Editar mi cuenta" abre el panel de Clerk), datos de facturación (`FacturacionForm`, bloqueado si la cuenta está vinculada), cuenta de cliente y, sólo con cuenta corriente, el portal del CRM. |
| `/mi-cuenta/direcciones` | Direcciones y envíos: direcciones de envío guardadas (con Clerk; alta y edición en la misma sección, ver [Direcciones de envío](#direcciones-de-envío)), envío a domicilio y retiro derivados de `src/lib/envio.ts` y un aviso. El domicilio fiscal ya no está acá: vive en Mis datos. |
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
| Cookie heredada del CRM, sin Clerk | Pedidos, Direcciones y envíos (+ Facturas cuando exista). `/datos` pide iniciar sesión; en `/direcciones` se invita a iniciar sesión para guardar direcciones y se ven las reglas de envío. El checkout no cambia. |
| Clerk sin cuenta vinculada | Pedidos, Favoritos, Direcciones y envíos, Mis datos, Seguridad, Cerrar sesión. |
| Clerk con cuenta vinculada | Igual, con facturación bloqueada y, si es cuenta corriente, el portal. |

`CAPACIDADES_DESPLIEGUE` (`{ favoritos, facturas }`) enciende cada sección
cuando su rebanada la publica: navegación y menú del header leen la misma
bandera. `favoritos` está encendida.

## Estado y seguimiento del pedido

- **Una sola pill** (`src/lib/estado-pedido-pill.ts`): cancelado → pago
  rechazado → pago pendiente → pago confirmado → estado. Con los pagos apagados
  (flag `pagos` apagado) un pedido pendiente dice "Pendiente" y no
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

## Direcciones de envío

Guardadas por usuario de Clerk (como favoritos). Hasta **10** por usuario y
exactamente **una predeterminada**.

**Tabla** `shop.direcciones_envio` (migración `0003_direcciones_envio`):
`tenant_id`, `clerk_user_id`, `etiqueta` (opcional: "Casa", "Obra"), `calle`,
`ciudad`, `provincia`, `cp`, `referencias` (opcional, para quien entrega),
`predeterminada`, `created_at`, `updated_at`. Índice por (tenant, usuario) e
índice único **parcial** por (tenant, usuario) `WHERE predeterminada`: la
base garantiza una sola predeterminada. `provincia` y `cp` son nullable en la
base pero la API los exige. Aplicarla a mano en producción **antes** de
desplegar (runbook en
[`una-base-esquema-shop.md`](./una-base-esquema-shop.md#migraciones-posteriores-a-la-baseline)).

**Reglas** (módulos puros, compartidos por formulario, checkout y API):

- `src/lib/direcciones-envio.ts`: validación y normalización (calle,
  localidad, provincia de la lista y CP obligatorios; CP de 4 dígitos o CPA),
  tope, vista y la línea que viaja al pedido.
- `src/lib/provincias.ts`: las 24 jurisdicciones y `provinciaCanonica`
  (acentos, "Provincia de …", CABA).
- `src/lib/envio.ts` → `ciudadConEnvio`: **única** definición de la zona de
  envío para una dirección guardada. Se puede guardar cualquier dirección del
  país; fuera de la zona (hoy `CIUDADES_ENVIO`) se guarda igual y se muestra
  "El envío a … se coordina por separado". Cuando el envío se abra a todo el
  país se cambia sólo `envio.ts` (`CIUDADES_ENVIO`/`ciudadConEnvio`/
  `evaluarEnvio`).

**Servidor** (`src/lib/direcciones-envio-db.ts`): toda consulta filtra por
tenant + usuario. Lista con la predeterminada primero y después la más nueva.
La primera que se guarda queda predeterminada; borrar la predeterminada
promueve la más reciente de las que quedan; marcar otra desmarca y después
marca, en una transacción. Editar no cambia la predeterminada salvo que se pida
(no se "desmarca": se elige otra).

**API** `/api/mi-cuenta/direcciones` (dinámica, `Cache-Control: private,
no-store`, sólo Clerk). Toda mutación devuelve la lista completa.

| Método y ruta | Body | Respuesta |
|---|---|---|
| `GET /api/mi-cuenta/direcciones` | — | `200 { direcciones }` |
| `POST /api/mi-cuenta/direcciones` | `{ etiqueta?, calle, ciudad, provincia, cp, referencias?, predeterminada? }` | `201 { direccion, direcciones }` |
| `PUT /api/mi-cuenta/direcciones/[id]` | igual que el alta (reemplaza los datos) | `200 { direccion, direcciones }` |
| `DELETE /api/mi-cuenta/direcciones/[id]` | — | `200 { direcciones }` |
| `POST /api/mi-cuenta/direcciones/[id]/predeterminada` | — | `200 { direcciones }` |

Errores: `401 { error: "No autorizado" }` sin Clerk; `400 { error:
"Solicitud inválida." }` si el cuerpo no es un objeto JSON; `404 { error: "No
encontramos esa dirección." }` **uniforme** para un id ajeno, inexistente o
que no es uuid (éste sin consultar la base); `422 { error: "Revise los datos
de la dirección.", errores: { campo: mensaje } }` por validación y `422 {
error: "Alcanzó el máximo de 10 direcciones guardadas." }` en el tope; `429`
pasadas 60 solicitudes por minuto por usuario (`direcciones:clerk:<id>`,
sumando todas las rutas).

**UI** (`DireccionesEnvio` + `DireccionForm`, en `/mi-cuenta/direcciones`):
cards con Badge "Predeterminada", "Editar" (el formulario reemplaza a la card),
"Usar como predeterminada" y "Eliminar" (Dialog de confirmación). "Usar la
misma dirección de facturación" copia calle, localidad, provincia y CP del
perfil fiscal; no aparece sin domicilio fiscal ni si otra guardada ya usa esa
calle. La calle se autocompleta con `DireccionAutocomplete` contra
`/api/geocode` (Nominatim con `countrycodes=ar`: todo el país, sin sesgo a la
zona de envío); localidad, provincia (`Select`) y CP están siempre a la vista,
así que una calle que OSM no conoce se carga igual.

**Checkout**: con Clerk y "Envío a domicilio", `SelectorDireccionEnvio`
arranca en la predeterminada; se puede elegir otra guardada u "Otra dirección
para esta compra" (los campos de siempre, sin tocar las guardadas). Con una
guardada, el pedido recibe la ciudad escrita como en `CIUDADES_ENVIO` y en
`entregaDireccion` calle, CP, provincia y referencias (hasta 200 caracteres).
Una guardada fuera de zona se lista con el aviso y `evaluarEnvio` la rechaza
para envío, igual que hoy cualquier ciudad fuera de la lista. Si leer las
direcciones falla, el checkout sigue sin precarga. Anónimos y cookie del CRM
sin Clerk: sin cambios. `POST /api/pedidos` no cambió.

## Componentes: servidor y cliente

`@myd-org/ui` se publica con `"use client"`. Un componente de servidor puede
renderizar `Card`, `Badge`, `Stepper`, `EmptyState` o `Alert` con props
serializables; todo lo que le pase una función al DS (`renderLink`,
`onSelect`, `onClick`) o use hooks (`useCart`, `useClerk`, `usePathname`)
lleva `"use client"`. Para un enlace con aspecto de botón desde una página de
servidor está `BotonEnlace` (`Button` con `href` + `next/link`).

## Guarda anti-literales

`src/components/mi-cuenta/sin-literales.test.ts` lee como texto
`src/components/mi-cuenta/**`, `src/app/mi-cuenta/**`,
`src/components/BotonFavorito.tsx` y `src/components/SelectorDireccionEnvio.tsx`, y falla ante valores arbitrarios (`[16rem]`), `clamp(`,
colores de la paleta o literales, overrides `[&_…]`, `style={}` o constantes
de clases; también ante voseo o tuteo en el texto y ante un `<h1>` fuera del
shell. Lo que el DS no tenga se agrega al DS, no como excepción.

## Follow-ups

- `pedidos-listo-retiro` (cross-repo): estado nuevo en el CRM y paso en el
  seguimiento.
- `pedidos-factura-vinculada` (cross-repo): guardar la factura del pedido para
  mostrar "Descargar factura" en la card.
- Envío a todo el país: cambiar la zona en `src/lib/envio.ts`; las
  direcciones guardadas fuera de zona pasan a servir para envío solas.
- Usar `PROVINCIAS_AR` también en el domicilio fiscal de `FacturacionForm`
  (hoy provincia de texto libre).
- Congelar el nombre real del producto en `order_items` al crear el pedido.
- Favoritos de anónimos guardados en el navegador y fusionados al ingresar.
- DS: `Alert` con tono `info` (hoy "Direcciones y envíos" usa `neutral`).
