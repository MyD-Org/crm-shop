# Cupones de descuento (CRM → Shop)

Fecha: 2026-11-01 · Estado: propuesta para revisión de Emanuel · Apps: `apps/admin` (CRM) y `apps/clientes` (Shop) · Contrato CRM↔Shop: sí (tablas de cupones en `public`, canjes en `shop`).

## Por qué

La pauta de Instagram de la tienda apunta a tres cosas a la vez: alcance, seguidores de @centralled.mdp y, sobre todo, **ventas**. La mecánica elegida es un **descuento en la primera compra, por tiempo limitado, a cambio de seguir la cuenta**.

Instagram no deja saber desde la web quién sigue una cuenta. Sólo se puede verificar dentro de una conversación por DM (campo `is_user_follow_business` de la User Profile API de mensajería). Por eso el flujo empieza en Instagram:

1. El anuncio, la historia o el post dicen "Escribanos LUZ por DM".
2. Un bot de DM (herramienta externa, p. ej. ManyChat) verifica si la persona sigue la cuenta. Si no la sigue, le pide que la siga y vuelva a escribir.
3. Si la sigue, el bot pide a la plataforma un **código único** y se lo manda con el link a la tienda.
4. La persona se registra en la tienda y compra con el código.

Hoy la plataforma no tiene cupones. Lo que aparece como "cupón" en el código es el cupón de pago de Payway, otra cosa. Este spec cubre los cupones y el endpoint que usa el bot. La configuración del bot y el mail de bienvenida van aparte (ver "Fuera de alcance").

## Qué es un cupón

Se separan dos cosas:

- **Promoción**: la regla. Nombre, beneficio, condiciones y vigencia. Se crea en el CRM.
- **Código**: lo que tipea el comprador. Una promoción tiene uno o muchos.

### Dos tipos de promoción

| Tipo | Códigos | Uso típico |
|---|---|---|
| **Genérica** | Un solo código elegido a mano (p. ej. `APERTURA10`). Lo usan muchas personas. | Un código publicado en una historia, un volante o el local. |
| **Códigos únicos** | Generados por la plataforma, uno por persona, de un solo uso. Se emiten por el endpoint del bot o en lote desde el CRM. | El bot de Instagram. Un código que se filtra sirve una sola vez. |

### Beneficio

- **% de descuento**: entero de 1 a 50. Opcional si hay envío gratis.
- **Envío gratis**: sí o no. Opcional si hay %.
- Al menos uno de los dos.
- Monto fijo ("$5.000 de descuento"): fuera de v1 (decisión mía, ver "Fuera de alcance").

### Condiciones

- **Vigencia**: inicio y fin con hora de Argentina (`-03:00`), fin exclusivo, igual que las campañas. Un código único puede además vencer a los **N días de emitido** (opcional, p. ej. 7 días): vence lo que ocurra primero. Sirve para dar urgencia real ("su código vence el 12/11").
- **Sólo primera compra** (por defecto sí). Decisiones mías:
  - Se miran sólo los pedidos **de la tienda**, no la historia del local ni de Alegra.
  - Un pedido previo cuenta si está **pagado** (`pago_estado = 'pagado'`) o **avanzó** de estado (`confirmado`, `preparacion`, `en_camino`, `entregado`). Un primer intento abandonado (pago vencido o rechazado, transferencia nunca hecha) **no** cuenta: ese es justamente el público de la campaña.
  - Tampoco se puede tener **otro pedido vivo con un cupón de primera compra** (vivo = mismo criterio que la reserva de stock, ver "Shop: dueño de los canjes"). Esto frena abrir dos pedidos pendientes con dos códigos.
  - Se compara por `clerk_user_id` y también por email: frena una segunda cuenta con el mismo mail. Un mail distinto no se frena (límite conocido).
- **Compra mínima** (opcional): sobre el subtotal con IVA de **todo el carrito a la lista general**, antes del descuento (decisión mía). Incluye las líneas en campaña: el mínimo mide el tamaño de la compra, no sobre qué se aplica el %. Se usa la lista general y no la del medio para que cambiar de medio de pago no haga aparecer ni desaparecer el cupón (con transferencia, más barata, un carrito podría quedar debajo del mínimo).
- **Medios de pago** (opcional): ver la sección siguiente.

### Medios de pago y listas de precios

**El cupón no elige listas: elige medios de pago.** La lista de precios es un mecanismo interno: la decide el servidor a partir de lo que elige el comprador (medio, forma y cuotas), con la precedencia de siempre (`lista-medio.ts`: forma > lista del medio > general; cuotas sin interés: la lista de la condición). Una misma lista puede servir a varios medios y una condición de cuotas apunta a otra lista. Restringir por lista sería confuso para quien carga el cupón y no coincidiría con lo que ve el comprador. Por eso el cupón se restringe por lo que el comprador elige, y el % se aplica sobre **la lista que rija esa elección**, sea cual sea.

Tres filtros, todos opcionales, en la promoción:

- **Medios**: lista de slugs de `medios_pago_shop` (p. ej. sólo `transferencia`). Vacío = todos los medios públicos. El medio de cuenta corriente (`audiencia = cuenta_corriente`) nunca acepta cupones.
- **Formas** (sólo Mercado Pago y Payway): `credito`, `debito`, `cuenta_mp`. Vacío = todas. Un medio sin formas (transferencia, efectivo) no se ve afectado por este filtro.
- **Cuotas**: "sólo en 1 pago" o "también en cuotas sin interés". Por defecto, **sólo en 1 pago** (decisión mía): las cuotas sin interés ya tienen el costo financiero absorbido en su lista, y sumarles un cupón come margen dos veces. Las cuotas **con interés** de Mercado Pago se calculan sobre el precio en 1 pago, así que ahí el cupón ya está incluido si el medio y la forma valen.

`a_coordinar` (pedidos a confirmar por venta sin stock) cuenta como un medio más: entra si la promoción no restringe medios o si lo incluye.

**Qué ve el comprador en el paso Pago:**

- Cada card de forma de pago (`totalesOpciones` de `/api/carrito/cotizar`) muestra su total **con el cupón aplicado si esa opción es elegible**, y sin él si no lo es. Así compara totales reales.
- Las opciones elegibles llevan una etiqueta "Con su cupón" (reusa los `chips` del medio). Las no elegibles, una línea gris "El cupón no aplica con este medio".
- El selector de cuotas muestra cada cantidad con su total real: con cupón en 1 pago, y sin cupón en las cuotas sin interés si la promoción es "sólo en 1 pago".
- Si el comprador elige una opción no elegible, el resumen deja de mostrar el descuento y aparece el aviso "Su cupón es válido sólo {pagando con transferencia | en 1 pago | …}". El cupón queda guardado: si vuelve a una opción elegible, se aplica de nuevo.
- **Límite total de canjes** de la promoción (opcional). Para una genérica es la forma de tener un tope ("los primeros 100").
- **Usos por código**: siempre 1 en códigos únicos. En la genérica, 1 por cuenta (decisión mía).
- **Provincias del envío gratis** (opcional): si se cargan, el envío gratis sólo vale para entregas en esas provincias. Sin cargar, vale donde la tienda ya hace envío a domicilio. Así se puede dar envío gratis sólo en Mar del Plata y zona sin regalar un envío al norte.

### Lo que el cupón NO hace (decisión mía, todas)

- **El % no acumula con campañas de precios.** Las líneas que ya tienen precio de campaña quedan afuera del %. Hay que avisarlo en las condiciones del cupón. La promo de lanzamiento ya trae precios agresivos y acumular come margen.
  - Los dos beneficios son **independientes**: si todas las líneas están en campaña, el % no se aplica pero el **envío gratis sí** (si el cupón lo trae y se cumplen mínimo y zona). El cupón queda aplicado y el checkout aclara "El descuento no se suma a productos con precio promocional".
  - Sólo si el cupón no deja ningún beneficio, se rechaza con el mensaje de la tabla.
- **No aplica a compradores con lista privada** (cuenta corriente con lista propia). Ya tienen precio negociado. El checkout lo dice con un mensaje claro.
- **Exige sesión de la tienda** (cuenta de Clerk). Quien compra identificado sólo como cliente vinculado del CRM, sin cuenta de Clerk, no puede usar cupones: es una cuenta de empresa, no el público de la campaña.
- **Un solo cupón por pedido.**

## Reglas de precio

- El % se aplica sobre el **unitario de la lista que rige el pedido** (la del medio y forma de pago elegidos: transferencia, tarjeta, etc.), neto de IVA: `round(unitario × (1 − pct/100), 2)`. El IVA lo suma el Shop como hoy.
  - Es el mismo criterio que las campañas: el % se exhibe y se cobra contra el mismo precio.
  - Si el comprador cambia de medio, el descuento se recalcula sobre la lista nueva.
- **El descuento queda dentro del unitario de cada línea.** El pedido congela en `precio_unitario` el precio ya descontado, como hacen las campañas. Así, factura de Alegra, cobro en línea, cuotas y recotización siguen sin cambios: todos leen el unitario y el total del pedido.
  - Para trazabilidad, cada línea alcanzada guarda su unitario antes del cupón, y el pedido guarda una foto del cupón (ver "Pedido").
- **Envío gratis**: el costo de envío online ya es siempre 0. Hoy `envio_gratis` distingue "gratis" de "a coordinar". Un cupón con envío gratis fuerza `envio_gratis = true` cuando la entrega es a domicilio y la provincia está alcanzada. Con retiro en el local no hace nada. Para el local es un compromiso: el costo del envío lo absorbe la empresa.
  - Si el cupón sólo da envío gratis y el pedido es retiro, el cupón no se aplica y el checkout lo dice ("Este cupón es de envío gratis: elija envío a domicilio para usarlo").
  - **El envío gratis propio de la tienda** (`evaluarEnvio`, mínimo de `reglas_venta`) se evalúa sobre el subtotal **antes** del cupón (decisión mía). Así un cupón de % nunca le hace perder al comprador el envío gratis que ya tenía. `envio_gratis` = regla de la tienda **o** cupón.

## Cómo lo usa el comprador

### Dónde se ingresa

- **Link con el código**: `centralled.com.ar/?cupon=LUZ-7KQ2M`. Es lo que manda el bot. La tienda guarda el código en el carrito (servidor si hay sesión, navegador si no) y lo aplica sola al cotizar. Un aviso discreto confirma: "Cupón LUZ-7KQ2M guardado: se aplica en el checkout." (decisión mía).
- **Campo en el carrito y en el checkout**: "¿Tiene un código de descuento?" → campo + "Aplicar". Mayúsculas y minúsculas dan igual; se ignoran espacios y guiones de más.

### Qué ve

- En el resumen del carrito y del checkout, una línea propia: "Cupón LUZ-7KQ2M (10 %) −$X" en verde, y "Envío gratis (cupón)" si corresponde. Las líneas no muestran el descuento repartido; se ve una sola línea de cupón (decisión mía).
- Un link "Condiciones" al lado del cupón con el texto de la promoción (vigencia, mínimo, no acumula con otras promociones, sólo primera compra). Lo carga el CRM.
- Si vence en menos de 48 h: "Su cupón vence el 12/11 a las 23:59." Sin cuenta regresiva.
- En el detalle del pedido (Mi cuenta y mails): la misma línea del cupón.

### Mensajes de error (en usted)

| Caso | Mensaje |
|---|---|
| No existe | "El código no es válido. Revíselo e inténtelo de nuevo." |
| Vencido o promoción terminada | "Este cupón venció." |
| Todavía no empezó | "Este cupón se puede usar desde el {fecha}." |
| Ya usado (código único) | "Este cupón ya fue usado." |
| No es la primera compra | "Este cupón es sólo para la primera compra en la tienda." |
| Falta monto | "Este cupón requiere una compra mínima de $X." |
| Todas las líneas en campaña y el cupón no trae envío gratis aplicable | "Los productos de su carrito ya tienen precio promocional: el cupón no se suma." |
| Sin sesión de la tienda (sólo cliente vinculado) | "Para usar un cupón, inicie sesión con su cuenta de la tienda." |
| Medio, forma o cuotas no elegibles | "Su cupón es válido sólo {pagando con transferencia \| con tarjeta de débito \| en 1 pago}." (aviso, no error: el cupón queda guardado) |
| Lista privada | "Su cuenta tiene precios propios: este cupón no aplica." |
| Límite agotado | "Se agotaron los cupones de esta promoción." |
| Sólo envío gratis y retiro, o provincia no alcanzada | "Este cupón es de envío gratis a {zona}: elija envío a domicilio a esa zona para usarlo." |

Un cupón que deja de valer entre el carrito y la confirmación sale con el `409 precio_cambio` de siempre, con el motivo `cupon` y el mensaje de la tabla.

Antes de iniciar sesión el cupón se valida sin las reglas que dependen de la cuenta (primera compra, lista privada) y se muestra como "se aplicará al confirmar si corresponde". La validación final es siempre la del POST del pedido.

## Cómo viaja

### CRM: dueño de promociones y códigos

Tablas nuevas en `public` (migración del CRM, siguiente número libre):

- **`cupon_promociones`**: `id uuid`, `tenant_id`, `nombre`, `tipo` (`generica` | `unicos`), `pct smallint null` (1–50), `envio_gratis bool`, `provincias_envio text[] null`, `inicio timestamptz`, `fin timestamptz`, `vence_dias_desde_emision smallint null`, `solo_primera_compra bool default true`, `minimo numeric(14,2) null` (con IVA, a la lista general), `medios text[] null` (slugs; NULL = todos los públicos), `formas text[] null` (NULL = todas), `permite_cuotas bool default false` (cuotas sin interés), `limite_canjes int null`, `condiciones text` (lo que se muestra al comprador), `prefijo text` (para los únicos, p. ej. `LUZ`), `activa bool default true` (pausa manual), `creado_por`, timestamps.
  - CHECKs: `fin > inicio`; `pct is not null or envio_gratis`.
- **`cupon_codigos`**: `id uuid`, `promocion_id`, `tenant_id`, `codigo text` (normalizado en mayúsculas), `origen` (`manual` | `lote` | `integracion`), `referencia_externa text null` (el id del contacto del bot, ver endpoint), `vence_en timestamptz null`, `emitido_en`.
  - Único por `(tenant_id, codigo)`.
  - Único por `(promocion_id, referencia_externa)` cuando no es nulo: la misma persona que vuelve a pedir recibe el mismo código.
- Formato de los únicos: `<PREFIJO>-` + 5 caracteres de un alfabeto sin ambiguos (sin 0/O, 1/I/L). Unos 20 millones de combinaciones por prefijo; se reintenta si choca.

**Vista y permisos para el Shop:** SELECT para `shop_app` sobre una vista `cupones_shop` que une código y promoción y sólo expone lo necesario para validar (sin `creado_por` ni `referencia_externa`). Bloque de GRANT condicional de siempre.

**Contrato:** actualizar `apps/clientes/src/db/crm.ts`, `__fixtures__/crm-contrato.json` y el doc del contrato en `MyD-Org/platform` en el mismo cambio.

### Shop: dueño de los canjes

Tabla nueva en `shop` (migración del Shop, después de la del CRM):

- **`cupon_canjes`**: `id`, `codigo_id`, `promocion_id`, `order_id` (único), `clerk_user_id`, `email`, `descuento_total` (con IVA, para reportes), `created_at`. Una fila por pedido con cupón. **Sin columna de estado** (decisión mía, ver abajo).

**El estado del canje se calcula, no se guarda**, con el mismo criterio que la reserva de stock (`shop.stock_reservado`) y las unidades de campaña (`campanias/unidades.ts`). Así nadie tiene que acordarse de actualizarlo: ni el CRM, que marca pagos offline y cancela pedidos, ni un cron.

- Un canje está **vivo** si su pedido no está cancelado y está pagado, avanzó de estado o tiene la reserva viva (`coalesce(reserva_vence_en, created_at + 24 h) > now()`). Es la misma expresión que usa `unidades.ts`; conviene extraerla para que las dos no se separen.
- Un canje está **usado** si su pedido está pagado o avanzó de estado. Es lo que muestra el CRM como "canjeado".
- Lo demás está **liberado**: pedido cancelado, o pendiente con la reserva vencida. El código vuelve a servir dentro de su vigencia y el límite total recupera la unidad.
- Una reserva sin vencimiento (`reserva_dias = 0`, `'infinity'`) mantiene el código tomado mientras el pedido siga pendiente, igual que el stock. Si se cancela, se libera.

**Concurrencia:** dentro de la transacción de `crearPedido`, advisory lock por código (únicos) o por promoción (genérica y límite total), luego se cuentan los canjes vivos y recién ahí se inserta. Es el patrón de `disponiblesEnTx` y de las unidades de campaña. Si no queda lugar: `409` con motivo `cupon` y el mensaje de "ya usado" o "se agotaron".

**Pago tardío de un pedido liberado** (webhook atrasado de Mercado Pago, o el CRM marca pagada una transferencia vieja) cuyo código ya se usó en otro pedido: se acepta. El pago ya entró y el pedido conserva su precio. Es un doble uso de un solo código, raro y de monto acotado. El detalle de la promoción en el CRM lo muestra con la marca "Canje duplicado" (decisión mía).

### Cotización

- `/api/carrito/cotizar` y `POST /api/pedidos` aceptan `cupon` (texto). Una función pura nueva aplica el cupón sobre la cotización ya hecha (después de campañas y lista): decide qué líneas alcanza, aplica el % y devuelve el descuento.
  - La `Cotizacion` suma `cupon: { codigo, pct, envioGratis, descuento, condiciones, venceEn } | null` y, si no se pudo aplicar, `cuponError: { motivo, mensaje }`. Un cupón inválido **no** bloquea el pedido: el pedido se puede confirmar sin él. El checkout muestra el error y deja quitarlo.
  - El `totalVisto` que manda el checkout ya incluye el descuento. Si difiere, sale el 409 de siempre.
- **Pedidos ya creados**: al recotizar (`/api/pedidos/[id]/medio` y `/cuotas`), el cupón se toma de la foto del pedido y se valida con la fecha de creación del pedido, igual que las campañas. No se vuelve a mirar "primera compra", el mínimo ni el límite (ya están reservados). El % se aplica sobre la lista del medio, forma y cuotas nuevos.
  - **Cambio a una opción no elegible** (otro medio, otra forma, o cuotas sin interés con una promoción "sólo en 1 pago"): el pedido se recotiza **sin descuento**, `orders.cupon` queda en NULL y se borra el canje, que libera el código. El checkout lo avisa **antes** de confirmar el cambio, con los dos totales: "Con {opción} el cupón no aplica: el total pasa de $X a $Y". Decisión mía: no se bloquea el cambio de medio, porque el comprador tiene que poder pagar aunque su tarjeta no sea la del cupón.
  - Volver después a una opción elegible no recupera el cupón en ese pedido (ya se liberó). Puede volver a ingresarlo, y se valida de nuevo como en un pedido nuevo.
  - Con la promoción pausada o vencida después de crear el pedido, el pedido conserva su descuento mientras no cambie a una opción no elegible.

### Pedido

Migración del Shop:

- `orders.cupon jsonb null`: foto `{ codigoId, codigo, promocionId, nombre, pct, envioGratis, descuento }`. `descuento` con IVA, para mostrar la línea del cupón sin recalcular.
- `order_items.precio_sin_cupon numeric null`: unitario neto antes del cupón, sólo en líneas alcanzadas.

El detalle del pedido en el CRM muestra "Cupón LUZ-7KQ2M (10 %) −$X" y, si fue el caso, "Envío gratis por cupón".

### Endpoint para el bot (CRM)

`POST /api/integraciones/cupones/emitir`

- **Auth**: header `Authorization: Bearer <token>`. Cada promoción de códigos únicos puede generar **un token de integración** desde el CRM. Se muestra una sola vez, se guarda hasheado y se puede regenerar o revocar. El token identifica tenant y promoción: el bot no elige la promoción.
- **Body**: `{ "referencia": "<id del contacto en el bot>" }`. Obligatorio. Es el id que la herramienta de DM le da a cada persona (en ManyChat, el `subscriber id`).
- **Respuesta 200**: `{ "codigo": "LUZ-7KQ2M", "link": "https://<tienda>/?cupon=LUZ-7KQ2M", "venceEn": "<iso>|null", "nuevo": true|false }`.
  - Misma `referencia` → mismo código (`nuevo: false`), aunque ya esté usado. Así un reintento del bot no regala códigos.
  - `link` sale de la URL pública de la tienda del tenant.
- **Errores**: 401 token inválido o revocado; 409 `promocion_inactiva` (pausada, vencida o sin empezar); 409 `limite_alcanzado` si la promoción tiene límite y ya se emitieron tantos códigos como el límite × 3 (decisión mía: tope de emisión para frenar abuso sin cortar conversiones); 429 por rate limit (60 por minuto por token).
- **El endpoint no verifica el seguimiento en Instagram**: eso lo hace el bot antes de llamarlo. La plataforma confía en el token.
- Logs de una línea sin datos personales (promoción, `nuevo`, resultado).

### Medición

- El evento `Purchase` del Pixel y de GA4 suma `coupon: "<codigo de la promoción o prefijo>"`. Se manda el prefijo o el nombre de la promoción, nunca el código único (decisión mía: el código es casi un dato personal y no aporta al reporte).
- `InitiateCheckout` también lleva el cupón si hay uno guardado.

## CRM: pantalla "Cupones"

Dentro de Catálogo, junto a Campañas y Precios online, con el mismo permiso (`requireAdminPlus`).

- **Listado**: nombre, tipo, beneficio, vigencia, estado (Programada / Activa / Pausada / Terminada), códigos emitidos, canjes usados y descuento total otorgado.
- **Formulario**: todos los campos de la promoción. Medios y formas con casillas que salen de los medios activos del tenant (los de cuenta corriente no aparecen); cuotas con un interruptor "También en cuotas sin interés". Para la genérica, el código. Para los únicos, el prefijo, el vencimiento desde la emisión y el token de integración ("Generar token", "Revocar").
- **Generar lote** (sólo únicos): cantidad (hasta 500) → descarga CSV con los códigos. Para volantes o el local.
- **Detalle**: tabla de canjes con pedido (link al pedido), fecha, estado calculado (Reservado / Canjeado / Liberado, más "Canje duplicado" si corresponde) y descuento. Sin email en la tabla por defecto (decisión mía: se ve en el pedido).
- **Acciones**: Pausar / Reanudar (afecta canjes nuevos; los pedidos ya creados conservan su descuento), Editar (no se puede cambiar el tipo ni el % una vez que hay canjes; sí el fin, el límite, las condiciones y la pausa), Eliminar (sólo sin canjes).
- Historial: cada guardado deja una entrada con autor, como las campañas.

## Casos de uso (validación del diseño)

Cada caso dice cómo se configura y qué pasa. Sirven también como casos de prueba de punta a punta.

| # | Caso | Configuración | Qué pasa |
|---|---|---|---|
| 1 | **Bot de Instagram**: 10 % en la primera compra, 7 días para usarlo | Únicos, prefijo `LUZ`, 10 %, primera compra, vence a los 7 días, token de integración | El bot pide el código con el id del contacto y manda el link. La persona entra, se registra y compra con el 10 % sobre la lista del medio que elija (sólo en 1 pago, por defecto). |
| 2 | **Lo mismo, pero con envío gratis en MdP y zona** | Caso 1 + envío gratis, provincias: Buenos Aires | Envío a domicilio en Buenos Aires: 10 % + envío gratis. Envío a otra provincia: sólo el 10 %, envío a coordinar. Retiro: sólo el 10 %. |
| 3 | **"10 % extra pagando por transferencia"** | Genérica `TRANSFER10`, 10 %, medios: transferencia, sin primera compra | El 10 % se aplica sobre la lista de transferencia, que ya es más barata. Con tarjeta, la card muestra el total sin cupón y el aviso "válido sólo pagando con transferencia". |
| 4 | **Cupón sólo con débito o cuenta de Mercado Pago** (promo tipo banco) | 10 %, medios: mercadopago, formas: débito y cuenta_mp | Crédito muestra el total sin cupón. Débito y cuenta MP, con cupón y sobre la lista de su forma (si el medio tiene listas por forma). |
| 5 | **Que el cupón valga también en cuotas sin interés** | Caso 1 + "También en cuotas sin interés" | El selector de cuotas muestra cada cantidad con el 10 % sobre la lista de esa condición de cuotas; la cuota es ese total ÷ N. |
| 6 | **Cupón "sólo en 1 pago" y el comprador elige 6 cuotas** | Caso 1 (por defecto) | El selector muestra 6 cuotas sin cupón. Si elige 6 cuotas, el resumen saca el descuento y avisa "válido sólo en 1 pago". En 1 pago vuelve el descuento. |
| 7 | **Carrito todo en campaña** (promo de lanzamiento) con un cupón de 10 % + envío gratis | Caso 2 | El % no se aplica a ninguna línea. El envío gratis sí, si la zona y el mínimo valen. El cupón queda aplicado con la aclaración "no se suma a productos con precio promocional". |
| 8 | **Carrito todo en campaña, cupón sólo de %** | Caso 1 | El cupón no deja beneficio y se rechaza con "Los productos de su carrito ya tienen precio promocional". |
| 9 | **Carrito mixto** (campaña + productos normales) | Caso 1 | El 10 % se aplica sólo a las líneas normales. El mínimo se mide sobre todo el carrito, a la lista general. |
| 10 | **Cambia de medio después de crear el pedido**, de transferencia a tarjeta, con el cupón del caso 3 | Caso 3 | Antes de confirmar el cambio ve "con tarjeta el cupón no aplica: $X → $Y". Si confirma, el pedido se recotiza sin descuento y el código se libera. |
| 11 | **Primer intento abandonado** (el pago de Mercado Pago venció) | Caso 1 | Ese pedido no cuenta como compra previa y su reserva vencida libera el código. La persona puede volver a usar el mismo código en un pedido nuevo mientras esté vigente. |
| 12 | **Dos checkouts a la vez con el mismo código único** | Caso 1 | El advisory lock por código deja pasar al primero. El segundo recibe 409 "Este cupón ya fue usado". |
| 13 | **Genérica con tope**: "los primeros 100" | Genérica `APERTURA`, 15 %, límite 100 | El canje 101 recibe "Se agotaron los cupones de esta promoción". Un pedido cancelado devuelve su lugar. |
| 14 | **Cliente con lista privada** | Cualquiera | "Su cuenta tiene precios propios: este cupón no aplica." Paga su precio de siempre. |
| 15 | **Pedido a confirmar por venta sin stock** (`a_coordinar`) | Caso 1 sin restricción de medios | El cupón se aplica sobre la lista general y queda congelado. El operador confirma el pedido con ese precio. |
| 16 | **Vence el cupón con el pedido pendiente de pago** | Caso 1 | El pedido conserva su descuento durante su ventana de pago, como las campañas. Si cambia a una opción no elegible, lo pierde. |
| 17 | **Volantes en el local** con códigos únicos | Únicos, lote de 200 desde el CRM (CSV) | Cada volante tiene un código. Se canjea en la tienda online como el caso 1, sin bot. |

**Casos que el diseño no cubre a propósito:** dos cupones en el mismo pedido; cupón en una venta del local o en una cotización del CRM; descuento de monto fijo; cupón sobre un producto o una marca puntual.

## Fuera de alcance (v1)

- **Configuración del bot de DM** (ManyChat u otro): no es código de este repo. Necesita el token y la URL del endpoint de arriba.
- **Mail de bienvenida y banner post-registro** que invitan a escribir por DM. El webhook `user.created` de Clerk ya existe en el Shop y es el punto de enganche. Va en un cambio propio.
- Monto fijo de descuento.
- Cupones por producto, marca o categoría.
- Acumular con campañas o varios cupones por pedido.
- Cupones para el local o para cotizaciones del CRM.
- Detección de cuentas duplicadas más allá del email (teléfono, dirección, tarjeta).

## No debe pasar

- Que el total cobrado difiera del que vio el comprador con el cupón aplicado.
- Que un código único sirva dos veces, o que una genérica supere su límite, ni siquiera con dos checkouts simultáneos.
- Que un pedido cancelado o vencido deje el código quemado.
- Que el cupón se sume a una línea con precio de campaña.
- Un "vence el" o un "quedan N" que no sea real.
- Exponer en el Shop o en el Pixel datos de quién pidió el código por Instagram.

## Restricciones

- Las migraciones del CRM se aplican a mano antes de mergear el código que las usa. La del Shop va después de la del CRM.
- **Numeración**: usar el siguiente número libre al implementar.
- El repo es público: fixtures sintéticos, dominios `.example`, ningún token real.
- Textos al comprador y del CRM en usted.

## Lo que queda al implementador

- La forma exacta de la función pura de aplicación del cupón y dónde se engancha en `cotizarConMedio`.
- Cómo se guarda el cupón en el carrito (columna en el carrito del servidor o junto a las líneas) y cómo se migra al iniciar sesión.
- El redondeo fino: el descuento por línea es exacto al centavo sobre el unitario; si la suma de líneas difiere del descuento "teórico" por redondeo, gana la suma de líneas.
- El hash del token y su comparación en tiempo constante.
- El diseño fino de la pantalla del CRM y del campo de cupón en el checkout, con los componentes de `@myd-org/ui` que ya usa la tienda.
