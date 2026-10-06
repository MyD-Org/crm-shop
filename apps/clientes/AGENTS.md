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

