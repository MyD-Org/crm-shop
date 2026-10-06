# apps/clientes — Shop

Las reglas comunes (Next.js, ecosistema, repo público, textos de UI) están en el `AGENTS.md` y `CLAUDE.md` de la raíz.

- Correr todo parado en `apps/clientes`.
- Esta carpeta no tiene `.npmrc`: para instalar `@myd-org/ui` en local hace falta la configuración del registro `@myd-org` en el `~/.npmrc` del usuario. En CI lo resuelve `actions/setup-node`.
- Integra con `apps/admin` por HTTP (cuotas, overlay de catálogo, revalidación). Docs en `docs/`.

## Sumar un procesador de pago

El cobro en línea es por procesador: el medio de pago (`slug` de `medios_pago_shop`) apunta a su procesador y el resto del flujo (ruta de cobro, webhook, reconciliación, rescate del pendiente, pie del checkout) no menciona a ninguno. Para sumar uno:

1. Implementar `ProveedorPago` en `src/lib/pagos/<id>.ts` (`configurado()`, `crearPago`, `consultarPago`, `cancelarPago`; `verificarWebhook` y `urlNotificacion` sólo si el proveedor avisa por webhook) y registrarlo en `src/lib/pagos/index.ts`.
2. Mapear el medio: `PROCESADOR_DE_MEDIO[slug] = "<id>"` en `src/lib/medios-pago.ts` (más su `PAGO_LABEL` en `src/lib/envio.ts` y su pie en `PIE_EN_LINEA`).
3. Componente de pago del navegador y un caso nuevo en `CheckoutClient.tsx` (donde se elige por `confirmado.procesador`).
4. Las rutas ya existen: `POST /api/pagos/[proveedor]` y `POST /api/pagos/[proveedor]/webhook` (404 si el proveedor no tiene `verificarWebhook`; el gate de `proxy.ts` ya deja pasar `/api/pagos/<x>/webhook`). La de Mercado Pago conserva su URL histórica. Sin credenciales, `configurado()` es `false` y el medio no se ofrece ni se acepta.
5. Tests: copiar el patrón de `route.caracterizacion.test.ts` (ruta) y `reconciliar.proveedores.test.ts`; el CSP del navegador (`headers-seguridad.ts`) se amplía en el cambio del componente de pago.

### Payway (ex Decidir)

Adaptador en `src/lib/pagos/payway.ts` (HTTP) y `payway-estados.ts` (puro: estados, motivos, ids de medio). Lo que condiciona todo, según la documentación oficial:

- La referencia del pago es el `site_transaction_id` (id del intento sin guiones, máx. 40), no el `payment_id`. La ruta de cobro la anota en el intento ANTES de llamar a Payway (`referenciaDeIntento`), así un timeout no deja un pago huérfano.
- `amount` va en centavos enteros (`centavos()`). Un rechazo llega como HTTP 402 con el cuerpo del pago: se parsea, no es un error.
- Sin respuesta (timeout, 5xx, red) se consulta por `siteOperationId` y NUNCA se reintenta el POST. Un pago que Payway no conoce queda `pendiente` y se da por "no llegó" a los 10 minutos.
- No hay webhooks: la conciliación es el cron (`consultarPago`). `cancelarPago` sólo consulta; no reembolsa nunca (devolver es manual, en el backoffice de Payway).
- El `payment_method_id` depende de marca y de crédito/débito (el débito va en 1 cuota).
- Variables: `PAYWAY_API_PRIVATE_KEY` (servidor), `PAYWAY_API_PUBLIC_KEY` y `PAYWAY_BASE_URL` (host de la API, https, sin `/api/v2`; sandbox: el de la API Reference oficial). Sin las tres el medio no se ofrece. `PAYWAY_SITE_ID` es opcional y hoy no se usa (la API no lo pide en el request); `PAYWAY_TEMPLATE_ID` es del formulario alojado y tampoco se usa. La key pública llega al navegador desde `GET /api/pagos/payway-config` (runtime), no por `NEXT_PUBLIC_*`.
- Formulario de tarjeta (`components/PagoPayway.tsx`): campos propios, crédito/débito explícito (Payway no lo deduce del BIN; el débito es 1 cuota, y las cuotas vienen congeladas en el pedido). Tokeniza en el navegador con el SDK JS oficial de Payway (`decidir.js` v2.6.4, cargado sólo al tocar "Pagar", ver `payway-token.ts`); si el script no carga, cae a `POST {base}/api/v2/tokens` directo (riesgo de CORS: sin respuesta se ve como falla de red, el mensaje dice que no se cobró y no se cobra nada). El servidor recibe sólo token, `bin`, `metodoPagoId` y cuotas (`payway-cobro-cliente.ts`); número y código de seguridad nunca se loguean ni se guardan y se borran del estado al obtener el token. CSP: `connect-src` y `script-src` de Payway sólo en `/checkout` (regla propia en `next.config.ts`). Huella Cybersource del SDK desactivada (`INHABILITAR_CYBERSOURCE`) hasta confirmar el antifraude con Payway; 3DS no implementado.
- Tests con `fetch` simulado y fixtures sintéticos en `src/lib/pagos/__fixtures__/payway/` (nada de keys ni llamadas reales).

