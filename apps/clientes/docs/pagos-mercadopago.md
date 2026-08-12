# Pagos online — Mercado Pago in-site

Plan de implementación de la fase 3: cobrar en la web, sin redirección, con
tarjeta y con dinero en cuenta de Mercado Pago.

Complementa `arquitectura-integraciones.md`. Hasta hoy el pedido nace en la DB
del shop con `pago_estado = 'pendiente'` y un operador lo mueve a mano
(`src/lib/pedidos.ts`). Este documento describe cómo ese estado pasa a moverse
solo.

## 1. Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Proveedor inicial | Mercado Pago | Ya hay cuenta de vendedor por el local. Toma Naranja, que pesa en Misiones. Mejor documentación del mercado. |
| Tipo de checkout | **Checkout Bricks** (Payment Brick) | Corre dentro del sitio, sin redirección. Los datos de tarjeta viven en iframes de MP: nunca tocan nuestro servidor ni nuestro código. |
| Medios | Tarjeta **+ dinero en cuenta** | Decisión del negocio. Ver §6: el saldo en cuenta tiene un paso de autenticación fuera del sitio, inevitable. |
| Descartado | Checkout Pro | Redirige. |
| Descartado | Checkout API (formulario propio) | Nos mete de lleno en PCI DSS con auditoría propia, sin ganancia real sobre Bricks. |
| Descartado | Payway | Contrato con Prisma, alta por marca, liquidación separada. Su ventaja es la comisión, y la comisión solo importa con volumen alto en tarjeta. |
| Diferido | Mobbex, MODO | Se enchufan después sin tocar el checkout. Ver §3. |

Mobbex quedó como el candidato para cuando las cuotas de Naranja (Plan Z, 5 y 8
cuotas) resulten un driver real de venta. MODO, para bajar el costo de la
transferencia. Los dos entran por la misma interfaz.

## 2. Reglas que no se negocian

Estas tres son las que evitan que nos roben. Cualquier PR que las viole se
rechaza, por más que "funcione".

1. **El monto sale siempre del pedido persistido**, nunca del browser. El
   servidor ya cotiza y congela totales (`src/lib/cotizacion.ts` +
   `crearPedido`); el Brick solo *muestra* ese número.
2. **El webhook es la única fuente de verdad.** La URL de retorno del comprador
   se puede escribir a mano en la barra de direcciones. No marca nada como
   pagado.
3. **Nunca confiar en el payload del webhook.** MP manda un ID; hay que
   *volver a consultar* el pago por API con nuestro Access Token antes de mover
   `pago_estado`.

## 3. Arquitectura: el pedido no sabe con quién se paga

El objetivo es que sumar Mobbex o MODO sea un archivo nuevo, no una refactor
del checkout.

```
src/lib/pagos/
  index.ts        # registro: proveedor → implementación
  tipos.ts        # interfaz ProveedorPago + tipos compartidos
  mercadopago.ts  # primera implementación
  # mobbex.ts, modo.ts  ← futuros, sin tocar nada de lo anterior
```

```ts
interface ProveedorPago {
  readonly id: string;                     // 'mercadopago' | 'mobbex' | 'modo'
  crearPago(pedido, medio): Promise<ResultadoPago>;
  verificarWebhook(req): Promise<{ valido: boolean; referencia?: string }>;
  consultarPago(referencia): Promise<EstadoPago>;
}
```

`ResultadoPago` y `EstadoPago` son **nuestros** tipos, no los de MP. La
traducción desde el vocabulario de cada proveedor ocurre dentro de su archivo.
Eso es lo que hace que el segundo proveedor sea barato.

Todo el módulo es server-only. El Access Token no puede filtrarse al bundle.

## 4. Base de datos

Migración **aditiva**, sin romper pedidos existentes. Sobre `orders`:

| Columna | Tipo | Para qué |
|---|---|---|
| `pago_proveedor` | `text` null | `'mercadopago'`, etc. Null en los pedidos viejos. |
| `pago_referencia` | `text` null | ID del pago en el proveedor. **Índice único** → idempotencia del webhook. |
| `pago_medio` | `text` null | `'tarjeta'` \| `'cuenta_mp'`. Para reportes. |
| `pago_detalle` | `text` null | `status_detail` crudo. Para poder debuggear rechazos reales. |
| `pago_actualizado_en` | `timestamptz` null | Cuándo lo movió el webhook. |

`pago_estado` ya existe y sus tres valores (`pendiente` / `pagado` / `fallido`,
en `src/data/orders.ts`) alcanzan. No se agregan estados: la riqueza va en
`pago_detalle`.

`PagoMetodo` en `src/lib/envio.ts` suma `'mercadopago'`, con su label y su
lugar en `pagosDisponibles()` (disponible tanto en retiro como en envío).

## 5. Flujo con tarjeta

1. El comprador completa el checkout. El servidor cotiza y **crea el pedido**
   con `pago_estado = 'pendiente'`. El pedido existe *antes* de intentar cobrar.
2. `CheckoutClient.tsx` monta el Payment Brick con la Public Key y el total del
   pedido.
3. El comprador carga la tarjeta dentro del iframe de MP. El Brick muestra las
   cuotas disponibles y devuelve un **token** en `onSubmit`.
4. `POST /api/pagos/mercadopago` con `{ pedidoId, token, cuotas, metodo }`.
   El servidor:
   - verifica que el pedido sea de quien está autenticado (Clerk);
   - verifica que siga en `pendiente` (evita doble cobro);
   - llama a MP con **el monto del pedido en la DB**;
   - manda header de idempotencia (ver §9).
5. Se persiste `pago_referencia` y se responde con el estado traducido.
6. El webhook confirma o corrige más tarde.

## 6. Flujo con dinero en cuenta — la salvedad

El Wallet Brick permite pagar con saldo de Mercado Pago, pero **el comprador
tiene que autenticarse contra Mercado Pago**. Eso es un paso fuera de nuestro
sitio y no hay forma de evitarlo: es MP validando a su propio usuario, no algo
que podamos embeber.

O sea: "sin redirección" es literal para tarjeta, y tiene un salto de login para
saldo en cuenta.

Cómo lo resolvemos en la UI: la tarjeta es la opción por defecto y visualmente
primaria; el saldo en cuenta es una opción secundaria que **avisa antes de
saltar** ("te vamos a pedir que inicies sesión en Mercado Pago"). Lo peor que
podemos hacer es que alguien pierda el formulario sin entender por qué.

Al volver, el pedido ya existe: se cae en `/mi-cuenta/pedido/[id]`, que muestra
el estado real leído de nuestra DB, no de la URL.

## 7. 3D Secure

Se habilita mandando `three_d_secure_mode: 'optional'` en la creación del pago.
Cuando el banco pide desafío, MP responde `status: pending` con
`status_detail: pending_challenge` y un objeto `three_ds_info` que trae
`external_resource_url` y `creq`.

Ese desafío lo renderiza el **Status Screen Brick**, al que se le pasan el ID
del pago y esos dos valores. No hay que armar el iframe del banco a mano.

Dos cosas operativas:
- El comprador tiene una ventana acotada para completarlo (la doc menciona
  ~5 minutos en un lado y hasta 40 en otro según el producto — **verificar al
  implementar**). Vencido, el banco rechaza y MP da el pago por cancelado.
- Mientras tanto el pago queda en `pending_challenge`. Para nosotros eso es
  `pago_estado = 'pendiente'`, y la pantalla del pedido tiene que decirlo con
  esas palabras, no "procesando" a secas.

3DS **sube la tasa de aprobación**: el banco tiene más señales para aprobar. No
es solo un requisito, es a favor nuestro.

## 8. Rechazos: el trabajo de verdad

Esta es la parte que Checkout Pro resolvía sola y ahora es nuestra. Si a todos
los rechazos les mostramos "error al procesar el pago", perdemos ventas que eran
perfectamente recuperables — la mayoría de los rechazos se arreglan reintentando
bien.

**El diseño**: no mapeamos códigos de MP directo a texto. Mapeamos
`código de MP → motivo interno → mensaje`. Así, cuando entre Mobbex, solo se
agrega una tabla de traducción; los mensajes se escriben una sola vez.

```ts
type MotivoRechazo =
  | "datos_invalidos"     // reintentable acá mismo
  | "fondos"              // reintentable con otra tarjeta
  | "limite"              // reintentable con otra tarjeta
  | "banco_rechazo"       // requiere llamar al banco
  | "tarjeta_inhabilitada"
  | "requiere_autorizacion"
  | "duplicado"
  | "demasiados_intentos"
  | "riesgo"
  | "desconocido";
```

Mensajes propuestos. Cada uno dice **qué pasó** y **qué hacer**:

| Motivo | Mensaje |
|---|---|
| `datos_invalidos` | Revisá el número, la fecha de vencimiento y el código de seguridad. |
| `fondos` | La tarjeta no tiene fondos suficientes para este monto. Probá con otra o pagá por transferencia. |
| `limite` | El monto supera el límite de tu tarjeta. Probá con otra, en cuotas, o por transferencia. |
| `banco_rechazo` | Tu banco rechazó la operación. Llamalos al número del dorso de la tarjeta y pedí que la habiliten para compras online. |
| `tarjeta_inhabilitada` | Esta tarjeta está inhabilitada. Llamá a tu banco para activarla o usá otra. |
| `requiere_autorizacion` | Tu banco necesita autorizar este pago. Llamalos al dorso de la tarjeta y volvé a intentar. |
| `duplicado` | Ya hicimos un pago igual hace unos minutos. Revisá tus pedidos antes de reintentar. |
| `demasiados_intentos` | Demasiados intentos con esta tarjeta. Esperá unos minutos o usá otra. |
| `riesgo` | No pudimos procesar el pago. Probá con otro medio o escribinos y lo resolvemos. |
| `desconocido` | No pudimos procesar el pago. Probá de nuevo o elegí transferencia. |

Regla de UX que se desprende: **el pedido sobrevive al rechazo**. Queda en
`pendiente`, con el carrito intacto, y se puede reintentar con otro medio sin
volver a cargar nada. Un rechazo no puede costarle al comprador rehacer el
checkout.

En `riesgo` no se explica el motivo real. Detallar el antifraude es darle un
mapa a quien está probando tarjetas.

**A verificar al implementar**: la lista exacta de `status_detail`. La doc vieja
usa `cc_rejected_*` sobre `status: rejected`; la doc nueva de Orders API usa
otros nombres (`bad_filled_card_data`, `rejected_by_issuer`,
`insufficient_amount`, `card_disabled`, `amount_limit_exceeded`) sobre
`status: failed`. Ver §10. La tabla de motivos internos de arriba aguanta las
dos: cambia solo el diccionario de entrada.

## 9. Webhook

`src/app/api/pagos/mercadopago/webhook/route.ts`.

- **Fuera del auth de Clerk.** Hay que agregarlo al matcher público en
  `src/proxy.ts`. Si queda detrás del auth, MP recibe 401 y los pagos nunca se
  confirman. Es el error clásico de esta integración.
- **Validar la firma** `x-signature` con el secreto del panel, comparando con
  `secure-compare` (ya existe en `src/lib/secure-compare.ts`) para no filtrar
  información por tiempo de respuesta.
- **Re-consultar el pago por API.** El payload solo se usa para saber *qué* ID
  mirar.
- **Idempotente.** MP reintenta y puede mandar el mismo evento varias veces. El
  índice único sobre `pago_referencia` más un update condicionado por estado
  hacen que el segundo evento no rompa nada.
- **Responder 200 rápido.** Si tardamos, MP reintenta y se acumulan eventos.
- **Nunca bajar de `pagado` a `pendiente`.** Los eventos pueden llegar
  desordenados. La transición es una máquina de estados explícita, no un
  `update` ciego.

Del lado de la creación del pago, el `POST` va con header de idempotencia
propio, derivado del ID del pedido y el intento. Sin eso, un doble click puede
cobrar dos veces.

## 10. Riesgos abiertos — verificar antes de codear

1. ~~**Dos generaciones de API conviviendo.**~~ **RESUELTO: se usa `/v1/payments`.**

   MP tiene dos caminos vivos. La Orders API existe y la están empujando, pero
   es un **modelo de integración distinto** (Checkout API vía Orders, el del
   formulario propio); Bricks documenta `/v1/payments`, y no hay aviso de
   deprecación. Combinar el front de Bricks con un backend de Orders sería una
   mezcla que la documentación no cubre, y un flujo de pagos no es el lugar para
   improvisar sobre combinaciones no documentadas.

   Los estados que se mapean, entonces, son los de `/v1/payments`:
   `approved` / `in_process` / `pending` / `rejected`, con `status_detail`
   `cc_rejected_*` y `pending_*`.

   Lo que sí hay que prever: MP está unificando las notificaciones al topic
   `order`, así que el webhook tiene que tolerar los dos topics y resolver por
   ID en vez de asumir la forma del payload.

   Si algún día se migra, el cambio queda contenido en `mercadopago.ts`: el
   resto del sistema habla en los tipos propios de §3.
2. **Compatibilidad del SDK.** Este proyecto corre React 19.2.4 y Next 16.2.9.
   Hay que confirmar que `@mercadopago/sdk-react` funcione ahí. Plan B: el SDK
   de JS puro montado a mano — funciona igual, da más trabajo.
   Antes de escribir componentes, leer `node_modules/next/dist/docs/` como pide
   `AGENTS.md`.
3. **Device ID.** MP usa una huella del dispositivo para el scoring antifraude.
   Si no se manda, **baja la tasa de aprobación**. Es un detalle chico que se
   olvida y después nadie entiende por qué rechazan tanto. Confirmar si el Brick
   lo inyecta solo o hay que sumar el script.
4. **Cuenta de vendedor.** La del local tiene que estar a nombre del CUIT. Si es
   personal, no se migra: hay que dar de alta una nueva.
5. **Webhook necesita URL pública HTTPS.** `localhost` no sirve. Durante el
   desarrollo apunta a un preview de Vercel.

## 11. Orden de implementación

1. Migración aditiva + `PagoMetodo` con `'mercadopago'`.
2. `src/lib/pagos/` con la interfaz y el mapeo de motivos de §8 — con tests,
   porque es lógica pura y es la que decide si se pierde una venta.
3. `mercadopago.ts`: crear pago, consultar, verificar firma.
4. `POST /api/pagos/mercadopago` + webhook + entrada en `proxy.ts`.
5. Payment Brick en el checkout, con manejo de rechazos y reintento.
6. Status Screen Brick para 3DS.
7. Wallet Brick con el aviso previo de §6.
8. Prueba end-to-end con cuentas y tarjetas de prueba de MP (gratis, sin
   credenciales de producción).
9. Recién ahí, el Access Token de producción como variable de entorno en Vercel.

Los pasos 1 a 8 no requieren nada de Fede. El 9 sí.

## 12. Variables de entorno

| Variable | Dónde | Nota |
|---|---|---|
| `MP_ACCESS_TOKEN` | server | **Secreto.** Nunca en el bundle ni en el repo. |
| `NEXT_PUBLIC_MP_PUBLIC_KEY` | cliente | Pública por diseño. |
| `MP_WEBHOOK_SECRET` | server | Firma del webhook. Secreto. |

Se cargan con `vercel env`, no en un `.env` commiteado.
