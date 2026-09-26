import { esLimiteAlegra } from "@/lib/cuenta-corriente/alegra-cc";
import { FACTURAS_PAGE_SIZE, getFacturasPage } from "@/lib/cuenta-corriente/erp-cc";
import { paramsFacturas } from "@/lib/cuenta-corriente/filtros";
import { jsonNoStore, requerirCuentaCorriente } from "@/lib/cuenta-corriente/guard";
import { ALEGRA_OCUPADO, FACTURAS_CAIDAS, motivoAlegra } from "@/lib/cuenta-corriente/mensajes";

/**
 * Páginas de facturas para "Cargar más" y los filtros de "Facturas y saldo".
 * `GET ?start&estado&desde&hasta` → `{ facturas, total }`.
 *
 * Portado de apps/admin/src/app/api/portal/facturas/route.ts. El cliente sale
 * de la identidad, nunca del query: un `client_id` en la URL se ignora. La
 * página es fija (30); no hay `limit` que pida el historial entero de una.
 */
export async function GET(request: Request) {
  const guard = await requerirCuentaCorriente();
  if (guard.error) return guard.error;

  const params = paramsFacturas(new URL(request.url).searchParams);
  if (params.error !== undefined) return jsonNoStore({ error: params.error }, { status: 400 });

  try {
    const pagina = await getFacturasPage(
      guard.cliente.codigocliente,
      params.start,
      FACTURAS_PAGE_SIZE,
      params.filtros,
    );
    return jsonNoStore(pagina);
  } catch (err) {
    if (esLimiteAlegra(err)) return jsonNoStore({ error: ALEGRA_OCUPADO }, { status: 503 });
    // Sólo el motivo técnico: nunca el cuerpo de Alegra ni datos del contacto.
    console.error(`mi-cuenta/facturas: Alegra falló (${motivoAlegra(err)})`);
    return jsonNoStore({ error: FACTURAS_CAIDAS }, { status: 502 });
  }
}
