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
| `/mi-cuenta` | Resumen: con avisos sin leer, un aviso "Tiene N avisos sin leer." → Avisos; tarjetas "Pedidos en curso", "Productos en el carrito" y (con Clerk) "Favoritos guardados"; los últimos 3 pedidos y (con Clerk) los 4 favoritos más recientes, cada uno con "Ver todos". Ninguna llamada a Alegra. |
| `/mi-cuenta/pedidos` | Todos los pedidos (los 50 más recientes). |
| `/mi-cuenta/pedidos/[id]` | Detalle: seguimiento, entrega, pago, productos y totales. Un id ajeno o que no es uuid da 404 (nunca 403). |
| `/mi-cuenta/datos` | Datos personales (nombre y correo de Clerk, en lectura; "Editar mi cuenta" abre el panel de Clerk), datos de facturación (`FacturacionForm`, bloqueado si la cuenta está vinculada), cuenta de cliente. Sin enlace al portal del CRM (ver [Cuenta corriente](#cuenta-corriente)). |
| `/mi-cuenta/direcciones` | Direcciones y envíos: direcciones de envío guardadas (con Clerk; alta y edición en la misma sección, ver [Direcciones de envío](#direcciones-de-envío)), envío a domicilio y retiro derivados de `src/lib/envio.ts` y un aviso. El domicilio fiscal ya no está acá: vive en Mis datos. |
| `/mi-cuenta/envios` | Redirige (308) a `/mi-cuenta/direcciones`: Envíos y retiro se unió a Direcciones. |
| `/mi-cuenta/favoritos` | Favoritos del usuario de Clerk en cards compactas (ver [Favoritos](#favoritos)). |
| `/mi-cuenta/facturas` | Facturas y saldo (ver [Cuenta corriente](#cuenta-corriente)). Sin vínculo: estado vacío con "Vincular mi cuenta". |
| `/mi-cuenta/pagos` | Pagos recibidos, detalle con imputaciones y PDF (ver [Pagos](#pagos-mi-cuentapagos)). Sin vínculo: estado vacío con "Vincular mi cuenta". |
| `/mi-cuenta/presupuestos` | Presupuestos con filtros y PDF (ver [Presupuestos](#presupuestos-mi-cuentapresupuestos)). Sin vínculo: estado vacío con "Vincular mi cuenta". |
| `/mi-cuenta/condiciones` | Condiciones comerciales, SÓLO cuenta corriente (ver [Condiciones](#condiciones-mi-cuentacondiciones)). Contado o sin vínculo: 404. |
| `/mi-cuenta/avisos` | Avisos de vencimiento (ver [Avisos](#avisos-mi-cuentaavisos)). Sin vínculo: estado vacío con "Vincular mi cuenta". |
| `/mi-cuenta/vincular` | Vinculación con la cuenta de cliente de Alegra (`VincularClient`). |

"Seguridad" y "Cerrar sesión" no son rutas: son acciones de la navegación
(`openUserProfile` y `signOut` de Clerk). `/mi-cuenta/seguridad` da 404.

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
| Cookie heredada del CRM, sin Clerk | Pedidos, Facturas y saldo, Direcciones y envíos. `/datos` pide iniciar sesión; en `/direcciones` se invita a iniciar sesión para guardar direcciones y se ven las reglas de envío. El checkout no cambia. |
| Clerk sin cuenta vinculada | Pedidos, Favoritos, Facturas y saldo (ofrece vincular), Mis datos, Direcciones y envíos, Seguridad, Cerrar sesión. |
| Clerk con cuenta vinculada | Igual, con facturación bloqueada y la cuenta corriente. |

`CAPACIDADES_DESPLIEGUE` (`{ favoritos, facturas, direcciones, pagos,
presupuestos, condiciones, avisos }`) enciende cada sección cuando su rebanada
la publica: navegación, menú del header y la ruta (`seccionDesplegada`, 404 si
está apagada) leen la misma bandera. Encendidas todas: `favoritos`,
`facturas`, `pagos`, `presupuestos`, `condiciones` y `avisos` (`direcciones`
además depende del flag `envio`).

El layout de Mi cuenta corre en cada página: con vínculo hace dos consultas a
la base y ninguna a Alegra — `tipoCuentaEspejo` (sólo el espejo, SIN el
respaldo en vivo de `contactoPorId`: una navegación no puede gastar cuota de
`/contacts`) para la entrada Condiciones, y `contarNoLeidos` para el badge de
Avisos. Si alguna falla, el menú se arma igual (sin Condiciones, sin badge).

## Cuenta corriente

La cuenta corriente del cliente de la tienda se muda del portal del CRM a Mi
cuenta (change `portal-al-shop`). El Shop **no enlaza nunca** al portal del
CRM: ese portal queda para las empresas sin tienda. La cookie heredada del
portal (`portal-session`, `origen: "cookie_crm"`) se sigue leyendo: un cliente
con sesión viva del portal ve su cuenta corriente sin Clerk.

Se publica por rebanadas, cada una con su bandera en
`CAPACIDADES_DESPLIEGUE`. Base:

- Datos: `src/db/crm.ts` declara la vista del espejo de contactos
  (`public.alegra_contacts_shop`), `tenants` (4 columnas),
  `client_commercial_conditions`, `notification_log` y `payment_receipts`;
  permisos en [una-base-esquema-shop.md](una-base-esquema-shop.md#cuenta-corriente-lecturaescritura-en-public).
- Contacto: `src/lib/contactos-espejo.ts` (`contactoPorId`, espejo primero y
  una consulta en vivo de respaldo).
- Lógica pura en `src/lib/cuenta-corriente/`: lecturas de Alegra
  (`alegra-cc.ts`), mapeos y saldo (`erp-cc.ts`), guard de las API
  (`guard.ts`), datos del tenant (`tenant-cc.ts`) y mensajes de WhatsApp
  (`whatsapp.ts`). Portados de `apps/admin/src/lib/{alegra,erp,whatsapp}.ts`.

### Facturas y saldo (`/mi-cuenta/facturas`)

- Saldo arriba: Deuda total (con límite y disponible sólo si corresponde),
  Saldo vencido y Saldo a vencer, cada una con sus 2 facturas más urgentes.
  Tocar una o "Ver todas" filtra la lista. Sale de TODAS las abiertas.
- Lista de a 30, primera página del servidor; "Cargar más" y los filtros van a
  `GET /api/mi-cuenta/facturas?start&estado&desde&hasta`. Pendientes y
  Vencidas salen de las abiertas completas sin pedir nada, igual que el
  portal (Alegra no filtra por vencimiento).
- PDF en el visor del DS (`DocumentViewer`) dentro de la página, servido por
  `GET /api/mi-cuenta/documentos/[kind]/[id]` (proxy con control de
  pertenencia; `?download=1` descarga).
- Deep link `?factura=<n>&alegra=<id>` (avisos): el servidor valida la
  pertenencia y abre el visor; ajeno o inexistente muestra "No encontramos la
  factura.".
- Selección de facturas → WhatsApp a la empresa ("Pagar" / "Consultar"),
  oculto si el tenant no tiene número.
- Cada bloque caído (saldo, facturas) muestra su aviso; el resto sigue.

### Pagos (`/mi-cuenta/pagos`)

- Recibos de pago (type=in) de a 10, primera página del servidor; "Cargar más"
  va a `GET /api/mi-cuenta/pagos?start`. Sin filtros: Alegra ignora las fechas
  en pagos.
- Cada pago: detalle en un diálogo con las facturas imputadas y su monto, y el
  PDF del recibo en el visor (o descarga).
- Selección → WhatsApp "Consultar", oculto si el tenant no tiene número.
- Alegra caída: aviso "No pudimos obtener sus pagos…"; el resto de Mi cuenta sigue.

#### Informar pago y Mis comprobantes

Sólo con el bucket de comprobantes configurado (`R2_RECEIPTS_*`); sin él no hay
botón y la API responde 503. No depende de Alegra: se ofrece aunque los pagos
no carguen.

- "Informar pago" abre un diálogo (monto, fecha, medio, notas, archivo PDF o
  imagen de hasta 20 MB, HEIC incluido). `POST /api/mi-cuenta/comprobantes`
  valida, aplica los topes (10 por hora en memoria, 20 por día contados en la
  base), crea la fila `uploading` en `public.payment_receipts` con los datos de
  la identidad y devuelve una URL PUT firmada: el navegador sube DIRECTO a R2
  (CORS del bucket con el origen del Shop). Después
  `POST /api/mi-cuenta/comprobantes/[id]/confirm` (nodejs, 60 s) verifica por
  magic bytes, convierte HEIC a JPEG (sharp + heic-decode), publica en
  `receipts/…` y deja la fila `pending`.
- Mismo bucket, mismas keys y mismos estados que el portal del CRM: el
  backoffice (`/admin/comprobantes`) no distingue de dónde vino. El Shop no
  borra nada (sin DELETE): los `uploading` huérfanos y los `rejected` viejos
  los limpia el listado del backoffice.
- Mail al `receipts_email` del tenant con el archivo adjunto (≤10 MB) y el
  botón "Ver en el backoffice" = `CRM_ADMIN_URL/admin/comprobantes?id=…`
  (nunca el host del Shop; sin `CRM_ADMIN_URL`, sin botón). Remitente
  `RECEIPTS_EMAIL_FROM` (o `EMAIL_FROM`). Sin destino ⇒ `email_status=skipped`.
- "Mis comprobantes": los `pending` ("En revisión") y `loaded` ("Registrado",
  con el número de recibo de Alegra si lo hay), de a 10 con "Cargar más"
  (`GET /api/mi-cuenta/comprobantes?start`). Los estados internos no se ven.

### Presupuestos (`/mi-cuenta/presupuestos`)

- De a 30, primera página del servidor; "Cargar más" y los filtros van a
  `GET /api/mi-cuenta/presupuestos?start&estado(aceptado|sin_aceptar)&desde&hasta`,
  resueltos en Alegra (aceptado = facturado). Vigente y vencido son los dos
  "sin aceptar" y se ven en el estado de cada fila.
- PDF en el visor (o descarga); selección → WhatsApp "Avanzar" / "Consultar".

### Condiciones (`/mi-cuenta/condiciones`)

- Sólo cuenta corriente: la página lee el contacto (`contactoPorId`: espejo y,
  si falta, una consulta en vivo) y da 404 si es contado. Sin contacto ⇒ aviso
  "No pudimos obtener sus condiciones comerciales".
- Como el portal: condición de pago (+ plazo si el nombre no lo dice), límite
  de crédito del espejo (con enlace a Facturas y saldo, donde están la deuda y
  el disponible: esta página no llama a Alegra), lista de precios y descuentos,
  vendedor (teléfono/email de `client_commercial_conditions`) y transporte. Lo
  que falta dice "Sin datos"; descuentos y transporte vacíos no se muestran.

### Avisos (`/mi-cuenta/avisos`)

- Lee `public.notification_log` del tenant y del cliente (`status = 'sent'`,
  tipos `before_due_N`, `after_due_N`, `conditions_changed`); el envío sigue
  en el CRM. Una fila por canal del mismo `(factura, tipo)` = UN aviso; el
  contador cuenta avisos, no filas.
- Abrir un aviso lo marca como leído (`PATCH /api/mi-cuenta/avisos {ids}`,
  sólo `read_at`; ids ajenos se ignoran con 200) y lleva a
  `/mi-cuenta/facturas?factura=<n>&alegra=<id>`; `conditions_changed` va a
  Condiciones si es cuenta corriente y, si no, a Facturas y saldo. Nunca al
  portal. "Marcar todos como leídos" = PATCH sin ids. Después se refresca la
  ruta para que el badge del menú quede al día (sin polling).

### Menú agrupado

| Grupo | Secciones |
|---|---|
| Compras online | Pedidos, Favoritos (sólo compras de la tienda) |
| Facturación | Facturas y saldo, Pagos, Presupuestos, Condiciones, Avisos (con badge de no leídos) |
| Mi perfil | Mis datos, Direcciones y envíos, Seguridad |

"Cerrar sesión" va aparte, al final. En mobile (fila horizontal) los grupos se
ven como separadores. La entrada del menú del header es "Facturación"
(→ `/mi-cuenta/facturas`); "Cuenta corriente" no se usa como título: lo ven
también clientes de contado.

### Quién ve qué

| Qué | Quién |
|---|---|
| Facturas y saldo, Pagos, Presupuestos, Avisos, Informar pago | Todo cliente vinculado (contado incluido). Sin vínculo, "Facturas y saldo" ofrece vincular. |
| Condiciones | Sólo cuenta corriente según el espejo (`alegra_contacts_shop.tipo_cuenta = 'corriente'`). Contado: sin entrada en el menú y `/mi-cuenta/condiciones` da 404. |
| Barra de límite de crédito / disponible | Sólo cuenta corriente con límite > 0. |

`tipo_cuenta` se lee del espejo (columna generada del CRM: plazo mayor a 0 o
límite mayor a 0); el Shop no la recalcula ni usa el `tipo_cuenta` guardado
en `client_links`.

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
(tenant, usuario, fecha) para el "más nuevo primero". Sin FK al
catálogo (vive en el CRM y un ítem puede desaparecer) ni a `public`. Aplicarla a
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
