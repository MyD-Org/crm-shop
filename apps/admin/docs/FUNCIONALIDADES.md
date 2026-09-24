# Funcionalidades del sistema — Portal CRM

> Estado al día de la última actualización. Portal B2B de autogestión para clientes
> de cuenta corriente, con datos del ERP **Alegra** y chat de soporte con IA.

## Índice

1. [Stack y arquitectura](#stack-y-arquitectura)
2. [Multitenant](#multitenant)
3. [Autenticación (OTP)](#autenticación-otp)
4. [Portal del cliente](#portal-del-cliente)
5. [Comprobantes de pago](#comprobantes-de-pago)
6. [Notificaciones](#notificaciones)
7. [Chat de soporte con IA](#chat-de-soporte-con-ia)
8. [Integración con Alegra (ERP)](#integración-con-alegra-erp)
9. [Espejo de contactos de Alegra](#espejo-de-contactos-de-alegra)
10. [Stock casi en tiempo real (webhooks de Alegra)](#stock-casi-en-tiempo-real-webhooks-de-alegra)
11. [Base de datos](#base-de-datos)
12. [Feature flags](#feature-flags)
13. [Referencia de endpoints](#referencia-de-endpoints)
14. [Variables de entorno](#variables-de-entorno)
15. [Comandos](#comandos)

---

## Stack y arquitectura

- **Next.js 16** (App Router, server components, route handlers, middleware)
- **TypeScript** strict
- **Drizzle ORM** + driver `postgres` sobre **PostgreSQL** (local vía brew, Neon en prod)
- **iron-session** (sesiones por cookie)
- **Resend** (envío de emails)
- **Tailwind CSS**
- **Vercel Flags** (feature flags) y **Vercel Cron** (tareas programadas)

Flujo general: el navegador entra al portal → el middleware resuelve el tenant →
las páginas (server components) leen datos de Alegra y de la DB propia → el cliente
se autentica por OTP → opera sobre su cuenta corriente.

---

## Multitenant

Un mismo deploy sirve a múltiples clientes (tenants), cada uno con su config aislada
(Alegra, branding, WhatsApp, chat IA) y su propio dominio.

### El Host es la fuente de verdad

`x-tenant-id` es un valor **derivado** del host, no una entrada. El proxy lo calcula y lo
propaga haciendo `.set()` sobre un clon de los headers entrantes — **esa sobrescritura, y
solo esa, es lo que lo hace confiable downstream**. Un `.append()` en un refactor futuro
reabriría el bypass en silencio, porque `headers.get()` devuelve el primero de la lista.

- **`src/proxy.ts`** — resuelve el tenant y lo inyecta como header de **request** con
  `NextResponse.next({ request: { headers } })`. Corre en Edge: solo valida que el id
  exista (`isKnownTenantId`), sin tocar la DB. Usa `tenantOverride()`, no la env cruda.
- **`src/lib/tenants.ts`** — `resolveTenantIdFromHost()` mapea host → tenant (dominio
  propio vía `{PREFIX}_DOMAINS`, o primer label del host). Normaliza adentro, así que
  proxy y guard no pueden desincronizarse. `tenantOverride()` ignora `TENANT_OVERRIDE`
  cuando `VERCEL_ENV === "production"`.
- **`src/lib/tenant-context.ts`** — `resolveRequestTenantId()` para decisiones de
  **seguridad**: Host → header → override (no-prod) → `null`. Ante discrepancia gana el
  host. `null` significa fallar cerrado. `getTenantConfig()` es para **branding**, no
  para autorizar.

### Aislamiento del backoffice

Una cuenta pertenece a **un** tenant y sus credenciales no sirven en otro.

- **Login** (`/api/admin/auth/login`) — busca por `(email, tenant del host)`. Timing
  parejo con un hash dummy: sin él, la existencia de la cuenta se filtra por latencia.
  Rate limit por `${tenantId}:${email}`, no por email solo.
- **Guard** (`admin/(protected)/layout.tsx`) — verifica contra la DB, no contra la
  cookie: una membresía revocada moriría recién al expirar la sesión. Si el host no
  coincide con el tenant de la sesión, redirige a `/api/admin/auth/expire`, que destruye
  la cookie (el layout no puede: `cookies()` es read-only fuera de Server Actions y
  Route Handlers).
- **`assign`** — el `operatorId` explícito se valida por forma de UUID, tenant y cuenta
  activa. Mismo 404 en los tres casos, para no dar oráculo.

Contención adicional: la cookie `admin-session` es **host-only** (no setea `domain`), así
que un navegador nunca la manda al dominio de otro tenant.

### Dar de alta un tenant

1. Fila en la tabla `tenants` — `npm run db:seed-tenant -- --id <id> ...`
2. Dominio agregado en Vercel.
3. `TENANT_IDS` con el id, y `{PREFIX}_DOMAINS` con los hosts **completos**
   (ej. `TEVRO_DOMAINS=www.plataforma.example,plataforma.example`).
4. **Redeploy** — las env vars se hornean en build.

Sin el paso 3 el host cae al fallback por primer label: `www.plataforma.example` resuelve a
`www` y responde `404 Tenant "www" not found`.

> **Pendiente**: nada impide hoy que `www`, `api`, `admin` o `app` se interpreten como
> ids de tenant vía ese fallback. Hay que blindarlo antes de dar de alta clientes como
> subdominios wildcard.

---

## Autenticación (OTP)

Login sin contraseña, por código de un solo uso (6 dígitos).

- **`POST /api/auth/send-code`** — recibe un identificador (ej. CUIT/email), genera un
  OTP de 6 dígitos válido **10 minutos** y lo guarda en una cookie de sesión OTP
  separada. *(Hoy el código se loguea por consola; falta cablear el envío real por email/SMS.)*
- **`POST /api/auth/verify-code`** — valida el código; si es correcto, busca el cliente
  en Alegra (contacto, por email/CUIT) y crea la sesión (`isLoggedIn`, `codigocliente`,
  `razonsocial`, `cuit`, `email`). El `codigocliente` es el id del contacto en Alegra.
- **`POST /api/auth/logout`** — destruye la sesión.

Dos cookies: `portal-session` (sesión principal) y `portal-otp` (verificación, TTL 10 min).
UI en **`LoginPage.tsx`** / ruta `/portal`.

---

## Portal del cliente

Ruta protegida `/portal/dashboard` (redirige a `/portal` si no hay sesión).

### Dashboard (`DashboardClient.tsx`)

- **Tarjetas resumen**: deuda total (con barra de uso de crédito), saldo vencido,
  saldo a vencer, con detalle de las principales facturas de cada grupo.
- **Tabs**: Facturas / Pagos / Presupuestos.
- **Facturas**: filtros por estado (todos/pendientes/vencidas/pagadas), búsqueda,
  filtro por fecha (emisión o vencimiento), ordenamiento por columnas, selección
  múltiple para descargar o consultar por WhatsApp. Soporta **pagos parciales**
  (muestra saldo restante).
- **Pagos**: recibos con sus facturas imputadas (un recibo puede cancelar varias
  facturas, total o parcialmente), búsqueda, filtro por fecha, ordenamiento.
- **Presupuestos**: estado (vigente/vencido/aceptado), búsqueda, filtro por fecha.
- **Navegación por URL**: acepta `?tab=&q=` para abrir una tab ya filtrada por
  comprobante (usado por las notificaciones).

### Condiciones comerciales (`/portal/condiciones`)

Vista de solo lectura con: condición de pago y crédito (barra de uso, roja >85%),
lista de precios y descuentos, vendedor asignado (con tel/mail), transporte y entregas.
Los datos viven en la **DB propia** (el ERP no las almacena).

### Header (`PortalHeader.tsx`)

Logo + subtítulo del tenant, chip "Tienda · Pronto" (deshabilitado), **campanita de
notificaciones** y menú de usuario (condiciones comerciales, salir).

---

## Comprobantes de pago

El cliente informa un pago desde **Pagos → "Informar pago"** (`InformarPagoModal.tsx`):
monto, fecha, medio (transferencia/cheque/efectivo/otro), notas y el archivo (PDF, JPG,
PNG o WebP, máx. **20 MB**; un HEIC de iPhone que se cuela por Mac/Files/AirDrop se
**convierte a JPEG en el server**, con resize a 2560 px y tope de 50 MP antes de
decodificar). El archivo sube **directo a un bucket R2** con URL prefirmada (PUT firmado
10 min, con Content-Type y tamaño firmados): los bytes nunca pasan por el servidor del
CRM. El `POST …/comprobantes/{id}/confirm` verifica leyendo desde R2 (magic bytes,
tamaño declarado, sha256 de los bytes publicados) y publica; metadatos y estado viven en
`payment_receipts`, el archivo queda en `receipts/{tenant}/AAAA-MM/…` del bucket. Las
imágenes (JPG/PNG/WebP/HEIC) se publican **sin EXIF/GPS** y con la orientación ya
aplicada; los PDF no se modifican.

**Estados** (máquina de estados con UPDATEs condicionales, sin read-then-write):
`uploading` (subiendo, invisible) → `processing` (verificando, invisible) → `pending`
(aviso en casilla, espera carga en el ERP) → `loaded` (cargado; se puede deshacer solo
mientras no tenga pago creado en Alegra).
`rejected` (invisible) guarda el motivo (tipo inválido, tamaño, mismatch) y no se
resucita. Límites anti-abuso: **20 informes por día** (filas no-`uploading` en 24 h) y
**10 inits por hora**; los `uploading` huérfanos (>24 h) se limpian al informar.

**Mail de aviso** al backoffice: sale a la casilla configurada en Configuración →
Comprobantes del tenant (`tenants.receipts_email`), con remitente de plataforma
(`RECEIPTS_EMAIL_FROM`) y asunto `[Comprobante de pago] …`. Hasta **10 MB** el archivo
va adjunto; más grande va con link al backoffice. El envío es best-effort: nunca cambia
el resultado del informe y se puede reenviar desde el admin (lease de 60 s, idempotency
key por intento).

**Backoffice** (`/admin/comprobantes`, rol admin+): tabs Pendientes/Cargados con
paginación, detalle, ver/descargar el archivo (redirect 302 a URL firmada de 5 min,
sin bytes en el body) y reenviar el aviso. El item del nav lo ve solo admin+.

**Cargar en Alegra** (botón del diálogo): crea el pago REAL en Alegra desde el
backoffice. El admin elige medio (transferencia/efectivo/depósito/cheque/tarjetas), cuenta
bancaria destino (requerida para transferencia/depósito/cheque) y a qué facturas abiertas
del cliente se imputa, con montos por factura y un helper "Repartir" (llena de la más vieja
a la más nueva hasta cubrir el monto); la suma tiene que ser exacta y ninguna imputación
puede superar el saldo de su factura. Monto y fecha son corregibles (el comprobante manda):
si difieren de lo informado, lo declarado queda guardado en `declared_amount` /
`declared_paid_on` (auditoría) y el diálogo lo avisa. El comprobante se adjunta al pago de
Alegra (best-effort: tope de 2 MB del adjunto; si falla, el pago queda cargado igual). Con
`alegra_payment_id` la fila muestra el número del pago en Alegra y no admite deshacer ni
re-carga — la guarda anti-duplicados es el UPDATE condicional `alegra_payment_id IS NULL`
(Alegra no tiene idempotency-key). "Ya lo cargué a mano" queda para los pagos cargados en
Alegra por fuera (solo cambia el status, como antes); los comprobantes marcados así antes
también ofrecen "Cargar en Alegra" después.

**Historial del cliente**: el historial de comprobantes informados vive dentro del modal
"Informar pago": la sección "Últimos comprobantes enviados" muestra los últimos 5 (fecha,
monto y estado Pendiente/Cargado) contra `GET /api/portal/comprobantes`, para frenar
duplicados en el momento de informar. El dashboard no lo trae server-side: lo pide el
modal al abrir. Si el cliente sube un archivo que ya había informado (mismo sha256), el
informe se recibe igual pero se avisa: banner en el modal y *"Posible duplicado…"* en el
mail al backoffice.

Requiere el set completo de env vars `R2_*`; sin ellas el botón no aparece en el
portal (degradación) y las rutas nuevas responden 503 — el resto del portal sigue igual.

---

## Notificaciones

### Gestor de cobranza (generación automática)

**`src/lib/notifications.ts` → `runNotifications()`**. Recorre las facturas impagas de
cada cliente, las cruza con las reglas del tenant (`notification_rules`) y envía
recordatorios por email (Resend). Deduplicación garantizada por unique index en
`notification_log`. Tipos generados:

- **`before_due_N`** — recordatorio N días **antes** del vencimiento (default: 3 y 1)
- **`after_due_N`** — aviso de mora N días **después** del vencimiento (default: 1, 7, 15)

Disparadores:
- **`POST /api/cron/notifications`** — corrida automática (Vercel Cron). Requiere `CRON_SECRET`.
- **`POST /api/notifications/send`** — disparo manual con filtros opcionales
  (`{ tenantId, codigocliente }`). Requiere `CRON_SECRET`.

Si no hay `RESEND_API_KEY`, hace **dry-run** (loguea sin enviar).

### Campanita en el portal

- **Badge** con la cantidad de **no leídas**.
- **Dropdown** con el historial (últimas 50), con **severidad visual**:
  por vencer (info/ámbar, ícono reloj) vs. vencida (rojo, ícono alerta).
- **Navegación**: cada notificación con destino lleva una flecha → que navega por URL
  (factura/pago/presupuesto → dashboard filtrado; condiciones → su página). Funciona
  desde cualquier página del portal.
- **Marcar como leída**: clic en la notificación (persistido en `read_at`, optimista) +
  botón **"Marcar todas como leídas"**.
- **`GET /api/notifications/log`** — historial del cliente logueado.
- **`PATCH /api/notifications/log`** — marca leídas (`{ ids }` o `{ all: true }`),
  siempre acotado al cliente de la sesión.

Tipo `conditions_changed` ("se modificaron tus condiciones") ya soportado en la UI.

> **Pendiente**: que `conditions_changed` se genere solo al editar una condición, y
> notificaciones de nuevo pago / nuevo presupuesto (a definir al conectar Alegra real).

---

## Chat de soporte con IA

Widget de chat embebido (proyecto `ai-widget`) conectado a `ai-api` (ambos de MyD-Org),
con las tools del agente consultando los datos reales del CRM.

- **`AiChat.tsx`** — monta el `ChatDrawer` con branding del tenant. Visible solo si el
  feature flag `ai-chat-enabled` está activo.
- **`POST /api/ai-token`** — crea una sesión de end-user en `ai-api` e incluye un
  `crm_token` (HMAC) en los claims, para que las tools del agente llamen al CRM como
  el usuario logueado.
- **Endpoints para el agente** (`/api/agent/*`), protegidos por Bearer token
  (`agent-auth.ts` + `agent-token.ts`, HMAC-SHA256, TTL 1h):
  - `GET /api/agent/invoices` — facturas (filtro `?status=paid|pending`)
  - `GET /api/agent/payments` — pagos
  - `GET /api/agent/account-balance` — saldo
- **CORS**: rewrite `/ai-api/*` → `ai-api` (configurado en `next.config.ts`).
- **Badges de novedades** — los ítems del sidebar del backoffice llevan contador de items
  nuevos desde la última visita a la sección (modelo last-visit en localStorage, por
  dispositivo): "Mensajes" cuenta conversaciones activas con `awaiting_reply` (las cerradas
  quedan con ese flag en la ai-api y no cuentan) y "Comprobantes" los `payment_receipts`
  pending (admin+; null para operadores). Entrar a la sección limpia su badge; lo que llega
  después vuelve a contar. Los sirve `GET /api/admin/pending-counts` (cache del raw 15 s; el
  cliente pollea cada 30 s, también con la pestaña oculta — avisar desde otra pestaña es el
  caso de uso).

---

## Integración con Alegra (ERP)

Alegra es el **ERP** del portal: reemplazó a Flexxus. Dos capas:

**`src/lib/alegra.ts`** — cliente de la API de Alegra (auth HTTP Basic `email:token`).
Credenciales por tenant (`{PREFIX}_ALEGRA_EMAIL/TOKEN`); sin credenciales corre en
**mock** (`mock-alegra.ts`). El mock se apaga solo al setear el token.

- **Catálogo**: `listAllCategories`, `listAllItems` — sync a cache local
  (`alegra-sync.ts`, cron `/api/cron/alegra-sync`) — y `getItemsLive` (precio/stock al momento).
  `getItemParaEspejo` lee UN ítem para el espejo distinguiendo 404 / 429 / error (lo usan los
  [avisos de stock](#stock-casi-en-tiempo-real-webhooks-de-alegra)).
- **Contactos (clientes)**: nadie del CRM los lee de acá directo: se leen del
  [espejo](#espejo-de-contactos-de-alegra) con `src/lib/contactos.ts`, que usa las versiones
  crudas (`getContactRaw`, `findContactRawByIdentifier`, `searchContactsRaw`,
  `createContactRaw`) solo como fallback acotado. `paginaDeContactos` (una página por llamada)
  es lo único que recorre el padrón entero, de a tramos, y solo desde la sync. Suscripciones de
  webhooks: `listWebhookSubscriptions` / `createWebhookSubscription` /
  `deleteWebhookSubscription`.
- **Cuenta corriente**: `listInvoicesByContact`, `listPaymentsByContact`, `getContactBalance`
  (deuda total / vencido / a vencer, derivado de las facturas abiertas).
- **Config de venta**: `listPriceLists`, `listPaymentTerms` (`/terms`), `listSellers`,
  `listTaxes`, `listCurrencies`.
- **Cotizaciones (estimates)**: `createEstimate`, `getEstimate`, `listEstimatesByContact`,
  `deleteEstimate`. Es la **única escritura** permitida contra Alegra: una cotización no es
  documento fiscal y se puede borrar por API. No exponer creación de facturas/pagos.

**`src/lib/erp.ts`** — adaptador que traduce Alegra a los tipos de dominio del portal
(`Cliente`, `Factura`, `Pago`, `Presupuesto`). Es lo que consumen el portal (dashboard,
login, condiciones), los endpoints `/api/agent/*` y el gestor de cobranza. En modo
`alegraMock` devuelve los fixtures de `mock-data.ts` — el portal funciona en dev sin
credenciales. Fechas normalizadas a `DD/MM/YYYY`; estados de Alegra mapeados a
`FacturaEstado`/`PresupuestoEstado`.

- `getCliente`, `getClienteByIdentifier` (login por CUIT/CUIL/DNI), `getClientes`,
  `getFacturas`, `getPagos`, `getPresupuestos`. Los **contactos** (cliente, login, lista de
  clientes, condiciones) salen del espejo de contactos (ver abajo), no de Alegra en vivo.
- `getCondiciones` — **excepción**: las condiciones comerciales NO están en Alegra,
  se leen de la DB propia (con fallback a mock).

> ⚠ Las cuentas de Alegra son **reales** (no hay sandbox). Smoke test contra una cuenta:
> `npm run alegra:smoke -- --tenant new-avantec` (solo lecturas) o con `--write-test`
> (crea una cotización marcada TEST y la **borra en el mismo run**).
>
> **Límite de crédito**: Alegra no expone un límite de crédito por contacto, así que hoy
> `Cliente.limitecredito` es 0 (la barra de uso de crédito del portal no muestra tope).
> A resolver desde la DB propia si se necesita.

---

## Espejo de contactos de Alegra

Copia del padrón de contactos de cada cuenta de Alegra en la base del CRM, para que nada
tenga que bajar el padrón en vivo (buscar por teléfono o listar clientes costaba ~200
requests contra una cuota de 150 req/min que comparten el CRM, el bot y el checkout del Shop).

**Tabla `alegra_contacts`** (migración 0030). Una fila por
`(tenant_id, alegra_account, alegra_id)`; `alegra_account` es `'principal'` mientras cada
tenant tenga una sola cuenta de Alegra, y todo lector filtra por esa constante
(`CUENTA_ALEGRA_PRINCIPAL`). Columnas normalizadas para buscar: `identification_norm` (solo
dígitos), `emails_norm` y `phones_norm` (arrays con índice GIN), `types` (`client`/`provider`).
Guarda también el contacto crudo en `raw`.

- `tipo_cuenta` es una **columna generada**: `'corriente'` si el plazo tiene días > 0 o hay
  límite de crédito > 0, si no `'contado'`. Es la regla canónica; los lectores leen la
  columna en vez de recalcularla.
- `status` NO es el estado de Alegra: es "visto en la última corrida OK" (`active` /
  `inactive`). El estado real de Alegra está en `alegra_status`.
- `origen`: quién escribió la fila por última vez (`sync`, `fallback`, `write_through`,
  `webhook`).

**Vista `alegra_contacts_shop`** (migraciones 0031 y 0032, vive solo en SQL). Es lo único
del espejo que lee el Shop, con el rol `shop_app` (`GRANT SELECT` sobre la vista, nada sobre
la tabla). Expone 20 columnas: las 16 de 0031 más `seller_name`, `payment_term_name`,
`payment_term_days` y `credit_limit` (0032, para Condiciones y la barra de límite de crédito
de "Mi cuenta" del Shop). Nunca `raw`, teléfonos ni `seller_id`. Si se cambia o borra una
columna expuesta, la vista se recrea **en la misma migración** (DROP + CREATE + GRANT).

**Permisos de `shop_app` sobre `public`** (0032, change `portal-al-shop`), mínimos y por
columna; sin DELETE en ninguna tabla:

| Objeto | Permiso |
|---|---|
| `alegra_contacts_shop` | SELECT |
| `tenants` | SELECT sólo `id, name, whatsapp_number, receipts_email` |
| `client_commercial_conditions` | SELECT |
| `notification_log` | SELECT, UPDATE sólo `read_at` |
| `payment_receipts` | SELECT, INSERT, UPDATE sólo las columnas del flujo de informar pago (`status`, `processing_started_at`, `reject_reason`, `file_*`, `converted_from`, `email_*`, `submitted_at`, `updated_at`); nunca `loaded_*`, `alegra_payment_*`, `declared_*`, `amount`, `codigocliente` |

Los GRANTs de las migraciones son condicionales: si el rol `shop_app` se creó después de
migrar, correr como owner el bloque `DO $$ … $$` del final de
`drizzle/0032_shop_cuenta_corriente.sql` (incluye el de 0031). La reversa (`REVOKE`) está en
el encabezado de ese archivo. El test
`test/integration/shop-cuenta-corriente-grants.integration.test.ts` corre ese mismo bloque y
verifica cada permiso como `shop_app`.

**Sync por tramos** (`src/lib/alegra-contacts-sync.ts`, ruta `/api/cron/alegra-contactos-sync`,
workflow `admin-alegra-contactos-sync`):

- Límite que manda: `/contacts` de Alegra admite **~5 requests por minuto por cuenta**
  (probado el 2026-09-23; la 6ª en la misma ventana recibe un 400 con `{"code":429}` en el
  body, que `alegraFetch` trata como 429). `/items` no tiene ese tope. El login del portal y el
  bot comparten ese cupo, así que la sync usa **3 páginas por minuto** y les deja ~2.
- Cada invocación de la ruta corre **un tramo por tenant**: a lo sumo `PAGINAS_POR_TRAMO` (3)
  páginas de 30, cada una upserteada en el momento, y deja el cursor en la bitácora. Si
  Alegra responde 429 a mitad de tramo, **no reintenta**: guarda lo leído y corta
  (`cortado: "alegra_429"`); la próxima invocación sigue desde ahí.
- Una **pasada** = de `start=0` hasta la página corta o vacía; la retoma la invocación
  siguiente. Central LED (~6000 contactos, ~200 páginas) tarda ~70 min; Avantec, 2 tramos.
- La respuesta dice por tenant `done` (la pasada cerró, bien o mal: no hace falta volver a
  llamar), `contactsSynced` (leídos en este tramo), `totalPasada` (leídos en la pasada),
  `markedInactive` y `requests` (de este tramo). Nunca datos de contactos ni mensajes de
  Alegra.
- Workflow: **una vez por semana**, domingo 03:15 UTC (00:15 en Argentina), lejos de las 06:00
  y 07:00 UTC (catálogos). Entre corridas el espejo lo mantienen los webhooks (ver abajo); la
  pasada semanal es el control: corrige avisos perdidos y da de baja lo que ya no está. Llama a la ruta, y cada ~60 s vuelve a llamar con `?tenant=` por cada
  tenant con `done: false`, hasta que todos terminen o se cumpla el tope (80 min;
  `timeout-minutes: 90`). Grupo de concurrencia `alegra-cuenta`. Un tenant que falla sale del
  loop, los demás siguen y el job termina en error. Si se llega al tope, deja un aviso y la
  pasada queda abierta: **la retoma la corrida siguiente** (la de la semana próxima, o un
  disparo a mano antes).
- Pasada abandonada: si una pasada lleva más de 8 días sin avanzar (`PASADA_VENCE_MS`), se
  cierra con `error = 'pasada_abandonada'` (sin bajas) y se arranca otra desde cero. Es más de
  una semana a propósito, para que una pasada cortada por el tope se retome y no se reinicie.
- Un error que no es 429 (Alegra 5xx, base) cierra la pasada en `error` sin bajas; la próxima
  arranca desde cero.
- Bajas soft: **solo al cerrar la pasada entera**. Lo que no se escribió desde el inicio de la
  pasada (`synced_at` anterior a `started_at`) pasa a `inactive`, **solo si** la pasada vio al
  menos el 80 % del padrón (vistos ≥ 80 % de vistos + activos no vistos); si no, queda en
  error `corrida_sospechosa` y no se da de baja nada.
- Candado por tenant (`pg_try_advisory_xact_lock`) durante el tramo (unos segundos): si otra
  invocación del mismo tenant está en medio de un tramo, se saltea (`skipped`, `done: false`).
- Con los webhooks activos, el espejo se entera de altas, ediciones y bajas en segundos. Sin
  ellos (o si un aviso se pierde) puede quedar hasta una semana atrás. Para reflejar algo ya:
  disparo a mano del workflow, o el fallback en vivo por id/documento.

**Bitácora `alegra_contacts_sync_log`**: una fila por **pasada** y tenant (no por tramo),
sin columnas propias para el cursor:

- `status`: `running` (pasada en curso) / `ok` / `error` / `skipped` (invocación que no hizo
  nada: `sin_credenciales` o `corrida_en_curso`).
- `contacts_synced`: contactos leídos en la pasada. Mientras está `running` **es el cursor**
  (el próximo `start`): toda página que no es la última trae exactamente 30.
- `requests`: cuota consumida en la pasada, reintentos incluidos.
- `finished_at`: fin del último tramo mientras está `running`; fin de la pasada al cerrarla.
- `error`: motivo técnico (`alegra_429`, `alegra_http_<status>`, `corrida_sospechosa`,
  `pasada_abandonada`, `corrida_en_curso`, `sin_credenciales`, `db_<código>`,
  `error_interno`). Nunca guarda nombres, emails ni documentos.

**Disparo a mano**: Actions → *admin · Sync contactos Alegra* → *Run workflow*, con `tenant`
vacío (todos) o un id de tenant. El workflow hace el loop; un tramo suelto equivale a:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://crm.plataforma.example/api/cron/alegra-contactos-sync?tenant=<TENANT_ID>"
```

**Si el padrón crece**: por corrida entran ~240 páginas (80 min × 3/min ≈ 7200 contactos).
Central LED (~6000) entra con poco margen. Un padrón más grande igual termina: la pasada se
retoma en la corrida siguiente (o con un disparo a mano), con las bajas demoradas hasta que
cierre. Si
eso molesta, subir el tope del loop y `timeout-minutes`, o `PAGINAS_POR_TRAMO` sabiendo que
come cupo del portal y del bot.

**Quién lee el espejo** (`src/lib/contactos.ts`, la única puerta del CRM a los contactos). Regla:
espejo primero; si no hay fila **activa**, una consulta en vivo acotada (nunca el padrón) y
upsert de lo que trajo (`origen = 'fallback'`). Una fila `inactive` cuenta como "no está".

| Lectura | Quién la usa | Espejo | Sin fila activa |
|---|---|---|---|
| `contactoPorId` | portal (`getCliente`, `getCuenta`, `getCondiciones`), verify-code | por `alegra_id` | `GET /contacts/{id}` (1 request); 404 → no existe |
| `contactoPorDocumento` | login del portal (send-code) | `identification_norm` = dígitos; si hay varios, gana el `client` y luego el id menor | las consultas de siempre por documento (≤ 4 requests, un 429 corta) |
| `buscarPorTexto` | bot, `GET /api/agent/contacts?q=` | nombre sin tildes (`unaccent ILIKE`) o documento exacto si `q` tiene ≥ 6 dígitos; 20 por nombre | `?query=` (1 request), solo si el espejo no encontró nada |
| `buscarPorTelefono` | bot, `GET /api/agent/contacts?phone=` | `phones_norm` contiene el teléfono normalizado; sin cuentas internas | **ninguno** (Alegra no filtra por teléfono: sería el padrón) |
| `clientesActivos` | gestor de cobranza / cron de notificaciones (`getClientes`) | `status` y `alegra_status` activos | **ninguno**: espejo vacío → no notifica y deja `espejo_vacio` en el log |
| `crearContacto` | bot, `POST /api/agent/contacts` | — | `POST /contacts` (1 request) y write-through al espejo; si la base falla, devuelve el contacto igual |

`tipoCuenta` sale siempre de la columna generada `tipo_cuenta`. Ninguna lectura de usuario
recorre `/contacts`: solo la sync, con `paginaDeContactos`. Lo vigila
`src/lib/alegra-exports.test.ts` (falla si vuelve un `listAllContacts`, un `fetchAllPages`
sobre `/contacts` o un uso de `paginaDeContactos` fuera de la sync).

**Webhooks de Alegra** (`src/lib/alegra-contacts-webhook.ts`, ruta
`POST /api/webhooks/alegra/contactos/<tenant>/<evento>/<token>`): Alegra avisa altas
(`new-client`), ediciones (`edit-client`) y bajas (`delete-client`) de contactos, una
suscripción por evento.

- Auth: `token` = HMAC-SHA256 de `alegra-contactos:<tenant>` con `ALEGRA_WEBHOOK_SECRET`
  (base64url), comparado en tiempo constante. Sin tabla ni migración: la ruta y el script lo
  recalculan igual. Rotar el secreto invalida todas las URLs (hay que recrear las
  suscripciones). Token inválido, evento o tenant desconocido → 404 (mismo 404 para todo).
- Responde 200 enseguida y aplica el aviso después (`after`): si el cuerpo trae el contacto
  completo (con `id`, `name`, `type` y `status`), upsert directo (0 requests); si trae solo el
  id o una forma que no se reconoce, lo lee por id (1 request) y upsert; `delete-client` →
  baja soft (`status = 'inactive'`) sin request, salvo que el id no sea inequívocamente el del
  contacto (un `id` suelto en la raíz): ahí se confirma leyéndolo. Si Alegra dice 404, baja.
- El formato del cuerpo y si Alegra firma los avisos **no están documentados**. La primera vez
  por (tenant, evento) y por instancia se loguean solo las **claves** del cuerpo (sin valores):
  `[webhooks/alegra] tenant=… evento=… claves=…`. Cada aviso deja
  `[webhooks/alegra] tenant=… evento=… accion=… id=… requests=…`. Nunca el cuerpo.
- Si algo falla (429, base), queda `accion=error` en el log y lo corrige la sync semanal o el
  fallback por id.
- Suscripciones: `scripts/alegra-webhooks-contactos.ts` (crear / listar / borrar las tres de
  un tenant; pide confirmación; cambia la configuración de la cuenta real de Alegra):

```bash
CRM_DATABASE_URL="<conexión de prod>" ALEGRA_WEBHOOK_SECRET="<el mismo de Vercel>" \
  npx tsx --env-file-if-exists=.env.local scripts/alegra-webhooks-contactos.ts \
  --tenant <TENANT_ID> --base-url https://<tenant>.plataforma.example crear
```

---

## Stock casi en tiempo real (webhooks de Alegra)

El espejo de productos (`catalog_products`) se entera de una venta, una compra o una edición de
ítem en Alegra en minutos, sin esperar la sync diaria. Change `webhooks-stock-alegra`.

**El aviso es sólo un disparador.** Alegra avisa por POST (`{"subject","message":{"invoice"|
"bill"|"item":{…}}}`, sin firma) y del aviso se toman únicamente los **ids de los ítems**
tocados. El stock se re-lee con `GET /items/{id}` y se guarda el valor **absoluto** (total de
todos los depósitos): nunca se suman ni restan cantidades del aviso.

**Eventos** (`EVENTOS_STOCK`, 9 suscripciones por tenant): `new-invoice`, `edit-invoice`,
`delete-invoice`, `new-bill`, `edit-bill`, `delete-bill`, `new-item`, `edit-item`,
`delete-item`. Movimientos que **no avisan** (ajustes de inventario, traslados, remitos, notas
de crédito): los corrige la sync diaria, que sigue siendo obligatoria.

**Ruta** `POST /api/webhooks/alegra/stock/<tenant>/<evento>/<token>`
(`src/lib/alegra-stock-webhook.ts`):

- Auth: `token` = HMAC-SHA256 de `alegra-stock:<tenant>` con `ALEGRA_WEBHOOK_SECRET` (hex, 32
  caracteres; distinto del de contactos: uno no abre la ruta del otro). Token inválido, evento
  o tenant desconocido → el mismo 404.
- **Antes de responder** registra el aviso en una transacción: índice documento→ítems, cola
  de re-lectura y contador del día. Si la base falla → 500. El POST de verificación `{}` que
  manda Alegra al crear la suscripción → 200 sin tocar nada.
- Reglas: una factura en borrador (`draft`) no encola (sólo actualiza el índice); anulada
  (`void`) sí; `edit-*` re-lee la unión de los ítems que el documento tenía y los que tiene
  ahora; `delete-invoice` llega con `items: []` y usa el índice (sin índice →
  `accion=sin_indice`, lo corrige la sync diaria); los avisos de ítems encolan ese id.
- **Después** (`after`): espera 5 s para juntar ráfagas y drena la cola del tenant (hasta 45 s).
- Log por aviso: `[alegra-stock] tenant=… evento=… doc=… accion=… items=… encolados=…`. Nunca
  el cuerpo (las facturas traen datos de clientes), montos ni el token.

**Cola y drenador** (`src/lib/alegra-stock-cola.ts`):

- `alegra_item_refresh`: una fila por (tenant, ítem). Cinco avisos del mismo ítem = una
  lectura. Re-encolar actualiza `pedido_at` y resetea `intentos`.
- Un solo drenador por tenant a la vez (lease en `alegra_stock_drenaje`, se libera solo a los
  90 s si la función muere). Ritmo fijo: **1 request por segundo** (≤ 60/min de los 150/min
  que la cuenta comparte con la sync, el portal y el bot).
- 404 → el producto queda `status='inactive'` (la fila no se borra). 429 → corta y deja todo
  en la cola. Otro error → `ultimo_error` (`alegra_http_500`, `db_…`) y se reintenta en el
  próximo drenaje; a los 5 intentos se descarta (`accion=descartado`) y lo corrige la sync.
- Frescura por fila: `catalog_products.alegra_leido_at` (cuándo se le pidió el dato a
  Alegra) y `leido_por` (`sync` | `webhook`). La lectura más nueva gana: la sync de la mañana
  no pisa lo que un aviso leyó después, ni un aviso viejo pisa la sync
  (`src/lib/catalog-products-repo.ts`).
- Log: `[alegra-stock/drenar] tenant=… leidos=… inactivos=… errores=… requests=… pendientes=… corte=… ms=…`.

**Cron de red** `GET|POST /api/cron/alegra-stock-drenar` (Bearer `CRON_SECRET`, `?tenant=`
opcional; workflow `admin-alegra-stock-drenar`, **cada 15 min**, grupo de concurrencia propio):
drena lo que quedó (hasta 270 s), purga la cola de más de 48 h y el índice de más de 400 días,
y devuelve por tenant `{ok, leidos, inactivos, errores, requests, pendientes, corte,
ultimoAvisoMin}`. Si un tenant lleva más de un día sin avisos, el workflow deja un
`::warning::` (Alegra puede desactivar suscripciones sin avisar).

**Prender** (por tenant; cambia la configuración de la cuenta REAL de Alegra, pide "SI"):

```bash
CRM_DATABASE_URL="<conexión de prod>" ALEGRA_WEBHOOK_SECRET="<el mismo de Vercel>" \
  npx tsx --env-file-if-exists=.env.local scripts/alegra-webhooks-stock.ts \
  --tenant <TENANT_ID> --base-url https://empresa.plataforma.example crear
```

`listar` muestra las suscripciones (token enmascarado) y marca las desactualizadas; re-correr
`crear` no duplica; si Alegra rechaza un evento, lo informa y sigue con el resto.

**Apagar**: `… scripts/alegra-webhooks-stock.ts --tenant <TENANT_ID> borrar` (sólo borra las de
stock, nunca las de contactos) y deshabilitar el workflow *admin · Drenar cola de stock
Alegra*. El espejo vuelve a depender de la sync diaria. Con la cola vacía, ruta y cron son
inertes.

**Rotar `ALEGRA_WEBHOOK_SECRET`** invalida las URLs de contactos **y** de stock: cambiar el
secreto en Vercel, redeploy, y correr `crear` de los dos scripts (detectan las URLs viejas;
bórrelas con `borrar` antes).

**Consultas de guardia** (solo lectura):

```sql
-- Backlog de la cola por tenant
SELECT tenant_id, count(*), min(pedido_at), max(intentos) FROM alegra_item_refresh GROUP BY 1;
-- Avisos recibidos hoy (hora de Buenos Aires)
SELECT tenant_id, evento, cantidad, ultimo_at FROM alegra_webhook_avisos
WHERE dia = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date ORDER BY 1, 2;
-- Productos re-leídos por aviso en la última hora
SELECT tenant_id, count(*) FROM catalog_products
WHERE leido_por = 'webhook' AND alegra_leido_at > now() - interval '1 hour' GROUP BY 1;
```

---

## Base de datos

DB propia del CRM (Postgres). Schema en **`src/db/schema.ts`** (Drizzle):

| Tabla | Descripción |
|---|---|
| `tenants` | Config por tenant (reemplaza las env vars `{PREFIX}_*`) |
| `client_commercial_conditions` | Condiciones comerciales por cliente (unique en tenant+cliente) |
| `notification_rules` | Reglas de notificación por tenant (días antes/después, canales) |
| `notification_log` | Historial de notificaciones; dedup por unique index; columna `read_at` |
| `payment_receipts` | Comprobantes de pago informados desde el portal: metadatos, máquina de estados y resultado del mail (el archivo vive en R2) |
| `alegra_contacts` | Espejo de contactos de Alegra (ver [Espejo de contactos](#espejo-de-contactos-de-alegra)); el Shop lee la vista `alegra_contacts_shop` |
| `alegra_contacts_sync_log` | Bitácora de la sync de contactos (estado, conteos, requests) |
| `alegra_item_refresh` | Cola de ítems a re-leer de Alegra por avisos de stock (ver [Stock casi en tiempo real](#stock-casi-en-tiempo-real-webhooks-de-alegra)) |
| `alegra_documento_items` | Índice factura/compra → ids de ítems del último aviso (sin datos del documento) |
| `alegra_stock_drenaje` | Lease del drenador de stock por tenant y último drenaje |
| `alegra_webhook_avisos` | Avisos de stock recibidos por tenant, día y evento |

- **`src/db/index.ts`** — singleton de conexión (`prepare: false` para Neon/pgbouncer).
- **`src/db/migrate.ts`** — aplica migraciones de `drizzle/`.
- **`src/db/seed.ts`** — seed idempotente (tenant central-led, condiciones CLI001, reglas default).

---

## Feature flags

**`src/lib/flags.ts`** (Vercel Flags). Flag actual:

- **`ai-chat-enabled`** (default `false`) — muestra la burbuja del chat de soporte.
  En dev se controla por env `AI_CHAT_ENABLED=true`.

---

## Referencia de endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/auth/send-code` | — | Genera y "envía" el OTP |
| POST | `/api/auth/verify-code` | OTP cookie | Valida OTP y crea sesión |
| POST | `/api/auth/logout` | sesión | Cierra sesión |
| GET | `/api/notifications/log` | sesión | Historial de notificaciones |
| PATCH | `/api/notifications/log` | sesión | Marca leídas (`ids` o `all`) |
| POST | `/api/notifications/send` | `CRON_SECRET` | Disparo manual del gestor de cobranza |
| POST/GET | `/api/cron/notifications` | `CRON_SECRET` | Disparo automático (Vercel Cron) |
| POST/GET | `/api/cron/alegra-contactos-sync` | `CRON_SECRET` | Sync del espejo de contactos (`?tenant=` opcional, `?trigger=manual`) |
| POST/GET | `/api/webhooks/alegra/contactos/<tenant>/<evento>/<token>` | token HMAC (`ALEGRA_WEBHOOK_SECRET`) | Avisos de contactos de Alegra → espejo (GET solo verifica la URL) |
| POST/GET | `/api/cron/alegra-stock-drenar` | `CRON_SECRET` | Drena la cola de re-lectura de stock (`?tenant=` opcional) |
| POST/GET | `/api/webhooks/alegra/stock/<tenant>/<evento>/<token>` | token HMAC (`ALEGRA_WEBHOOK_SECRET`) | Avisos de facturas, compras e ítems → cola de re-lectura (GET solo verifica la URL) |
| POST | `/api/ai-token` | sesión | Token de sesión para el chat IA |
| GET | `/api/agent/invoices` | agent token | Facturas (para el agente) |
| GET | `/api/agent/payments` | agent token | Pagos (para el agente) |
| GET | `/api/agent/account-balance` | agent token | Saldo (para el agente) |
| GET | `/api/agent/contacts` | agent token | Busca clientes en el espejo de contactos (`?q=` o `?phone=`) |
| POST | `/api/agent/quotes` | agent token | Crea una cotización en Alegra |
| GET | `/api/agent/quotes` | agent token | Cotizaciones de un contacto (`?contact_id=`) |
| GET | `/api/agent/sales-config` | agent token | Listas de precio, condiciones de pago, vendedores, impuestos, monedas + link del shop |
| POST | `/api/portal/comprobantes` | sesión portal | Informar pago: valida, rate limit y URL PUT prefirmada para R2 |
| POST | `/api/portal/comprobantes/{id}/confirm` | sesión portal | Verifica el archivo en R2 (tipo/tamaño/sha256) y publica el comprobante |
| GET | `/api/admin/comprobantes` | admin | Lista de comprobantes (status, paginado; sin URLs firmadas) |
| GET/PATCH | `/api/admin/comprobantes/{id}` | admin | Detalle / marcar cargado a mano o deshacer (idempotente; deshacer solo sin pago en Alegra) |
| GET | `/api/admin/comprobantes/{id}/file` | admin | Redirect 302 a URL firmada del archivo (sin bytes en el body) |
| POST | `/api/admin/comprobantes/{id}/resend-email` | admin | Reenvía el mail de aviso (lease 60 s, no toca el status) |
| GET | `/api/admin/comprobantes/{id}/load-context` | admin | Facturas abiertas del cliente + cuentas bancarias, para "Cargar en Alegra" |
| POST | `/api/admin/comprobantes/{id}/load-to-alegra` | admin | Crea el pago en Alegra (imputado a facturas elegidas), adjunta el comprobante y marca la fila |
| GET/PUT | `/api/admin/settings/receipts` | admin | Casilla de avisos de comprobantes del tenant |
| GET | `/api/admin/pending-counts` | sesión (cualquier rol) | Contadores de novedades para los badges del sidebar: inbox (activas con `awaiting_reply`) y comprobantes pending (admin+, null para operadores); filtra por `?since=`/`sinceInbox`/`sinceComprobantes` |

---

## Variables de entorno

| Variable | Para qué |
|---|---|
| `SESSION_SECRET` | Firma de sesiones y agent tokens |
| `RESEND_API_KEY` | Envío de emails (sin esto, dry-run) |
| `TENANT_IDS` | Lista de tenants activos |
| `TENANT_OVERRIDE` | Forzar un tenant en dev |
| `CENTRAL_LED_*` | Config del tenant (NAME, SUBTITLE, LOGO, MOCK, WHATSAPP, RESEND_FROM, AI_API_URL, AI_API_KEY, AI_AGENT_ID) |
| `{PREFIX}_MOCK` | `true` → el portal corre con fixtures (`mock-data.ts`) sin pegarle a Alegra |
| `{PREFIX}_ALEGRA_EMAIL` / `{PREFIX}_ALEGRA_TOKEN` | Credenciales de Alegra del tenant (sin token → mock) |
| `{PREFIX}_ALEGRA_MOCK` | Fuerza el mock de Alegra aunque haya token |
| `NEXT_PUBLIC_SHOP_URL` | Link de la tienda que comparte el agente (`sales-config`) |
| `DATABASE_URL` | Conexión Postgres |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Storage de comprobantes (Cloudflare R2); sin el set completo la feature se apaga |
| `RECEIPTS_EMAIL_FROM` | Remitente del mail de aviso de comprobantes |
| `CRON_SECRET` | Protege los endpoints de notificaciones |
| `ALEGRA_WEBHOOK_SECRET` | Deriva el token de las URLs de webhooks de contactos y de stock de Alegra (≥ 32 caracteres; sin él las rutas rechazan todo) |
| `AI_CHAT_ENABLED` | Activa el chat en dev |

---

## Comandos

```bash
npm run dev          # servidor de desarrollo
npm run build        # build de producción
npm run lint         # eslint
npm run db:generate  # generar migración desde el schema
npm run db:migrate   # aplicar migraciones
npm run db:seed      # seed inicial
npm run alegra:smoke # smoke test de Alegra (-- --tenant <id> [--write-test])
```
