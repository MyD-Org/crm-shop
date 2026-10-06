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
- Variables: `PAYWAY_PRIVATE_KEY`, `PAYWAY_PUBLIC_KEY`, `PAYWAY_BASE_URL` (host de la API, https; sin las tres el medio no se ofrece). No se cargan en Vercel hasta que exista el formulario de pago del navegador.
- Tests con `fetch` simulado y fixtures sintéticos en `src/lib/pagos/__fixtures__/payway/` (nada de keys ni llamadas reales).

