# Pagos: una cuenta de cobro por sucursal

Change `cuentas-procesador-por-sucursal`. Referencias: R1 = PR #527 (núcleo: variables con sufijo,
proveedores ligados a la cuenta), R2 = rama `feat/cuentas-procesador-r2` (migración 0035, fallback,
cuenta congelada, `pago_info`, webhook y conciliación), R3 = PR #528 (CRM: lectura de `pago_info`,
alerta de cobro con otra cuenta, aviso al facturar). Complementa `pagos-mercadopago.md`.

Este documento es la guía de operación: cómo se elige la cuenta, cómo se llaman las variables, qué
queda registrado y en qué orden se despliega.

## 1. La regla

Cada sucursal tiene su CUIT, su cuenta de Alegra y su cuenta en cada procesador (Mercado Pago y
Payway), en relación 1 a 1. El cobro en línea de un pedido va a la cuenta **de la sucursal que lo
factura**, para que quien cobra sea quien emite la factura.

La cuenta prevista de un pedido sigue la misma regla que la cuenta que factura en el CRM
(`resolverCuentaFactura`, sin la elección manual del operador):

1. la sucursal que fuerza la zona (`zonas.factura_sucursal`), si no
2. la sucursal del pedido (`orders.sucursal`), si no
3. la sucursal predeterminada del CRM.

Es una función pura (`cuentaDeCobro`, `src/lib/pagos/cuenta-cobro.ts`). El slug de la sucursal es el
identificador de la cuenta (`igz`, `mdp`).

Invariante que sostiene todo: **una sucursal = una cuenta de Alegra = un CUIT**. El CRM lo vigila con
un `console.error` si dos sucursales activas repiten la misma cuenta de Alegra, pero no lo impide.

## 2. Variables de entorno

Solo el Shop (`apps/clientes`) las lee, y solo `src/lib/pagos/credenciales.ts`; una guarda en
`credenciales.test.ts` falla si otro archivo de `src` nombra una de ellas.

El sufijo es el slug de la sucursal en mayúsculas, con `-` reemplazado por `_`: `igz` -> `_IGZ`,
`mdp` -> `_MDP`, `mar-del-plata` -> `_MAR_DEL_PLATA`. **No existen variables sin sufijo** ni
`NEXT_PUBLIC_MP_PUBLIC_KEY`: la clave pública de Mercado Pago llega al navegador desde el servidor,
por pedido, junto con la cuenta; la de Payway, desde `GET /api/pagos/payway-config?pedido=<id>`.

Plantilla (los `...` son los valores; los reales se cargan con `vercel env add`, nunca en el repo ni en un
archivo `.env` commiteado; el repo no admite archivos `.env*` ni siquiera de ejemplo):

```
# Mercado Pago: una terna por cuenta
MP_ACCESS_TOKEN_IGZ=...        # servidor, secreto
MP_PUBLIC_KEY_IGZ=...          # clave pública (APP_USR-...), va al navegador
MP_WEBHOOK_SECRET_IGZ=...      # firma de los webhooks de esa aplicación
MP_ACCESS_TOKEN_MDP=...
MP_PUBLIC_KEY_MDP=...
MP_WEBHOOK_SECRET_MDP=...

# Payway: un par por cuenta
PAYWAY_API_PRIVATE_KEY_IGZ=... # servidor, secreto
PAYWAY_API_PUBLIC_KEY_IGZ=...  # tokeniza la tarjeta en el navegador
PAYWAY_API_PRIVATE_KEY_MDP=...
PAYWAY_API_PUBLIC_KEY_MDP=...

# Payway: base de la API, COMPARTIDA por todas las cuentas (https, sin /api/v2)
PAYWAY_BASE_URL=https://api.payway.example
```

Cuándo una cuenta está "configurada":

- Mercado Pago: `MP_ACCESS_TOKEN_<S>` y `MP_PUBLIC_KEY_<S>`. El secreto del webhook no hace falta para
  cobrar, sí para validar avisos.
- Payway: `PAYWAY_API_PRIVATE_KEY_<S>`, `PAYWAY_API_PUBLIC_KEY_<S>` y `PAYWAY_BASE_URL` válida.

Un medio se ofrece si hay **al menos una** cuenta configurada del procesador. Tras cargar o cambiar
variables hay que redesplegar: la CSP del checkout se arma en el build.

El `MP_PUBLIC_KEY` sin sufijo del admin (aviso de cuotas en Medios de pago) es otra variable, de otra
app, y no cambia con este change.

## 3. Cómo se elige la cuenta que cobra

`elegirCuenta` (puro) recibe la prevista, las candidatas (prevista primero, luego la predeterminada y el
resto por slug; cada una con `configurada` y `rechazada`) y, opcionalmente, la cuenta con la que el
navegador tokenizó la tarjeta. Una cuenta es **usable** si está configurada y el procesador no
rechazó sus credenciales en ese pedido.

- Si la prevista es usable, cobra la prevista.
- Si la prevista no está configurada, cobra otra cuenta usable sin pedir nada al cliente: la clave
  pública que el servidor entrega al navegador para ese pedido (`configMpPara`, `payway-config`) ya es la
  de esa cuenta, así que el token se genera con ella desde el principio.
- Si el procesador responde **401 o 403** (credenciales rechazadas) el intento se cierra con
  `detalle = 'credenciales_rechazadas:<cuenta>'`, esa cuenta queda marcada como rechazada **para ese
  pedido** y el servidor responde `409 { motivo: "cuenta_rechazada", reintentable: true, config }`. El
  navegador aplica la `config` de la otra cuenta (clave pública nueva, remonta el Brick o el SDK de
  Payway) y el cliente **vuelve a ingresar la tarjeta**: un token de tarjeta está atado a la clave
  pública con la que se generó y no se reutiliza entre cuentas. No hay segundo POST automático.
- Si ya no queda ninguna cuenta usable: `502 { motivo: "cuentas_rechazadas" }` con el mensaje de
  inconveniente técnico; sin cuentas configuradas, `409` "medio no disponible".
- La cuenta que declara el navegador nunca elige: se valida contra la política. Si no coincide,
  `409 { motivo: "cuenta_no_valida", config }` con la configuración vigente. Un bundle viejo cacheado
  que no manda `cuenta` se tolera (el servidor resuelve).
- El pedido siguiente vuelve a intentar primero con su prevista: la evidencia de rechazo es por pedido.
  No hay circuit breaker; mientras una cuenta esté caída, cada cliente reingresa la tarjeta, y la
  alerta del CRM es el aviso.

**Nunca hay fallback por rechazo de pago.** Un pago rechazado por el banco, `402`, `400/422`, `5xx`,
timeout o red no cambia de cuenta: el rechazo es del cliente o del medio, no de las credenciales. Un
timeout deja el intento pendiente con **la misma cuenta** y se concilia con ella (cron y sondeo), de
modo que un pago nunca se cobra dos veces en cuentas distintas.

La cuenta usada queda **congelada en el intento**. Consulta, conciliación, cancelación y estado del
pago usan esa cuenta aunque hoy la prevista resolvería a otra. Los intentos anteriores a la migración
(columnas en `NULL`) derivan la cuenta del pedido.

Dato de sucursales (slug predeterminado, slugs): memo en memoria de 60 segundos por instancia
(`MEMO_CUENTAS_MS`). Alta, baja o cambio de la sucursal predeterminada pueden tardar hasta un minuto en
verse en el cobro. El pie del sitio (logos de tarjetas, `GET /v1/payment_methods`) usa la cuenta de
Mercado Pago de la sucursal predeterminada.

## 4. Qué queda registrado

Tabla `shop.pago_intentos` (migración **0035**, aditiva):

| Columna | Contenido |
|---|---|
| `cuenta` | slug de la sucursal cuya cuenta cobró (o intentó cobrar) el intento |
| `cuenta_prevista` | la que le correspondía al pedido |

`NULL` en ambas = intento anterior a la migración. Las filas cerradas con
`detalle = 'credenciales_rechazadas:<cuenta>'` (con `:cliente` si lo informó el navegador y no el
procesador) son la evidencia de rechazo de credenciales y no cambian `pago_estado`.

`orders.pago_info` (JSON, lo lee el CRM) al quedar el pedido pagado o con el medio informado:

| Clave | Contenido |
|---|---|
| `cuentaCobro` | slug de la cuenta que efectivamente cobró |
| `cuentaCobroPrevista` | la prevista, **solo si difiere** de la que cobró (= hubo fallback) |

Los pedidos viejos no tienen estas claves y el CRM lo tolera (sin alerta ni aviso).

Logs a mirar: `[pagos] cuenta_rechazada procesador=... pedido=...` (un fallback o un agotamiento),
`[webhook mercadopago] ... secretos repetidos` (dos cuentas con el mismo secreto: error de
configuración) y `... la pista cuenta=... no coincide con la cuenta que firmó` (la pista de la URL es
solo un dato para los logs, nunca autoridad).

## 5. Webhook de Mercado Pago

Una sola ruta: `<origen del entorno>/api/pagos/mercadopago/webhook`. En **cada** aplicación de
Mercado Pago (IGZ y MDP) se registra **la misma URL**, y el secreto de cada aplicación se carga como
`MP_WEBHOOK_SECRET_<S>`.

El servidor prueba la firma `x-signature` contra el secreto de cada cuenta con secreto cargado; la que
valida identifica la cuenta y con sus credenciales se vuelve a consultar el pago (el payload no es
confiable). Si ninguna valida: `401` y un solo log sin payload. Si ninguna cuenta tiene secreto: `401`
y log de configuración. Cada pago creado lleva además su `notification_url` con la pista
`&cuenta=<slug>`, solo para los logs. Payway no tiene webhook: se concilia por cron y sondeo.

Tras registrar la URL en el panel de Mercado Pago, probar con "Simular notificación" y comprobar en el
log que se identifica la cuenta esperada.

## 6. CRM (R3)

- Detalle del pedido, tarjeta Pago: fila "Cuenta de cobro", y la alerta "Cobro con otra cuenta" cuando
  hubo fallback (`cuentaCobroPrevista` presente).
- Emitir factura: si el pedido está pagado en línea y la cuenta de Alegra elegida no es la de la
  sucursal que cobró, aparece un aviso y el servidor exige confirmar
  (`confirmarCuentaDistintaDeCobro`) antes de emitir. El servidor revalida; no confía en la vista previa.
- Si el pedido no tiene `cuentaCobro` (pago viejo), la sucursal de cobro no tiene cuenta de Alegra o no
  hay pago en línea, no hay aviso ni bloqueo.
- **Límite conocido**: dos sucursales que comparten la misma cuenta de Alegra pero tienen cuentas de
  cobro distintas no se distinguen entre sí, así que el aviso no se dispara. Es consecuencia del
  invariante de la sección 1; hoy no se bloquea la carga de dos sucursales con la misma cuenta.

## 7. Despliegue, en orden

R1 y R2 se promueven **juntas** a `main` (R1 sola cobra solo con la cuenta prevista y falla cerrado si
no está configurada; sin la auditoría de R2). Todo PR va primero a `staging` y después va un PR aparte
`staging` -> `main` con merge commit (ver `docs/staging.md`).

1. **U1 - Variables `_IGZ`, antes de mergear R1 (#527) a cada entorno.** En Vercel (Production y
   Preview `staging`; `vercel env add X preview staging`) copiar los valores actuales a las variables
   con sufijo, y redesplegar:
   `MP_ACCESS_TOKEN` -> `MP_ACCESS_TOKEN_IGZ`, `NEXT_PUBLIC_MP_PUBLIC_KEY` -> `MP_PUBLIC_KEY_IGZ`,
   `MP_WEBHOOK_SECRET` -> `MP_WEBHOOK_SECRET_IGZ`, `PAYWAY_API_PRIVATE_KEY` ->
   `PAYWAY_API_PRIVATE_KEY_IGZ`, `PAYWAY_API_PUBLIC_KEY` -> `PAYWAY_API_PUBLIC_KEY_IGZ`.
   `PAYWAY_BASE_URL` no cambia. Las variables sin sufijo se **conservan** (el código nuevo las
   ignora; el rollback es un revert puro). Sin este paso, el pago en línea queda sin credenciales.
2. **U2 - Credenciales de prueba** (por variable de entorno de la shell, nunca en el chat ni en el
   repo) de dos cuentas de Mercado Pago y dos de Payway, para los spikes de sandbox y la prueba
   punta a punta en staging.
3. **Mergear R1 (#527) a `staging`.** Probar el cobro con `_IGZ`.
4. **U3 - Aplicar la migración 0035 en la base de staging** (`npm run db:migrate` desde
   `apps/clientes`; el comando no pide confirmación: sondear antes que la base sea la de staging).
   **Antes** de mergear R2 a `staging`, porque el código nuevo escribe las columnas y `db:migrate` no
   corre en el deploy.
5. **Mergear R2 a `staging`** (rama `feat/cuentas-procesador-r2`, rebasada sobre `staging`).
6. **U4 - Cargar `_MDP`** (MP: access token, public key y webhook secret; Payway: private y public) en
   staging y después en producción. Redesplegar.
7. **U5 - Webhook de Mercado Pago**: registrar la URL de la sección 5 y el secreto en la aplicación de
   MDP (y verificar la de IGZ); "Simular notificación" y ver el log.
8. **R3 (#528)**: independiente de R2 (lee `pago_info` y tolera su ausencia). Mergear a `staging`
   después de R2 para probar punta a punta: pedido de cada sucursal -> `cuentaCobro` correcto;
   forzando un token IGZ inválido -> alerta en el detalle del pedido; facturar con la otra cuenta ->
   aviso y confirmación.
9. **U6 - Aplicar la migración 0035 en producción** (confirmar antes la base y que la numeración siga
   siendo 0035) **antes** de mergear el PR `staging` -> `main` que contiene R2. La migración es
   aditiva: el código anterior la ignora.
10. **U7 - Promoción**: PR `staging` -> `main` con merge commit, con R1 y R2 juntos (R3 y este
    documento en el mismo PR o aparte). Después traer `main` a `staging`.
11. **U8 - Platform**: abrir el PR con la nota de la sección 9 en `MyD-Org/platform` y avisar al otro
    proyecto.
12. **U9 - Una semana sin incidentes en producción**: borrar de Vercel las variables **sin sufijo**
    (Production y Preview `staging`).

Rollback: antes de U9, revertir el código (las variables sin sufijo siguen cargadas). Las columnas de
0035 pueden quedar sin uso; su reversa está documentada en el encabezado del `.sql` y va en una
migración nueva.

## 8. Pendientes conocidos

- **Spikes de sandbox (T0.1 y T0.2)**: si el token de Payway es reutilizable entre cuentas (solo
  informa una optimización futura) y si el Brick o el SDK de Payway distinguen una clave pública
  inválida de otros fallos. Mientras T0.2 no se resuelva, `POST /api/pagos/cuenta-rechazada` existe y
  está probada pero **sin cableado desde el navegador**: rige solo la detección del servidor
  (401/403).
- Mercado Pago, por cuenta: `GET /v1/payment_methods` y la lista de tarjetas aceptadas del pie usan la
  cuenta predeterminada.
- El memo de sucursales de 60 s (sección 3).

## 9. Nota para platform

Texto a agregar en `MyD-Org/platform`, `sucursales/v1`, sección 6 (`medios_pago_shop` / cobro por
cuenta). No cambia el contrato de columnas existente; solo se suman campos aditivos. Sin datos de
producción.

> **Cobro por cuenta.** El cobro en línea de un pedido del Shop se hace con la cuenta del procesador
> (Mercado Pago, Payway) de la sucursal que lo factura, según la misma regla que la cuenta de Alegra
> con la que se emite la factura: la sucursal que fuerza la zona (`factura_sucursal`), si no la
> sucursal del pedido, si no la predeterminada. Se asume la relación 1 a 1 entre sucursal, cuenta de
> Alegra, CUIT y cuenta en cada procesador; las credenciales viven en el entorno del Shop, una por
> sucursal, y no en la base compartida.
>
> Contrato aditivo en `shop.orders.pago_info` (JSON): `cuentaCobro` (slug de la sucursal cuya cuenta
> cobró) y `cuentaCobroPrevista` (la que correspondía, presente solo si difiere de la que cobró, es
> decir, hubo un cambio de cuenta por credenciales rechazadas). Ambas pueden faltar en pedidos
> anteriores; el lector debe tolerar su ausencia. El CRM los usa para avisar cuando se factura con una
> cuenta de Alegra distinta de la que cobró. No se agregan columnas a las tablas que el Shop comparte
> con el CRM. El cambio de cuenta nunca ocurre por rechazo del pago, solo cuando el procesador rechaza
> las credenciales de la cuenta o cuando la cuenta prevista no está configurada.
