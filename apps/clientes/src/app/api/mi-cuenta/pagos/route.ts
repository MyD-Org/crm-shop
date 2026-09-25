import { esLimiteAlegra } from "@/lib/cuenta-corriente/alegra-cc";
import { PAGOS_PAGE_SIZE, getPagosPage } from "@/lib/cuenta-corriente/erp-cc";
import { paramsPagos } from "@/lib/cuenta-corriente/filtros";
import { jsonNoStore, requerirCuentaCorriente } from "@/lib/cuenta-corriente/guard";
import { ALEGRA_OCUPADO, PAGOS_CAIDOS, motivoAlegra } from "@/lib/cuenta-corriente/mensajes";

/**
 * Páginas de pagos para "Cargar más" de Mi cuenta → Pagos.
 * `GET ?start` → `{ pagos, total }`, de a 10 (cada pago trae sus imputaciones).
 *
 * Portado de apps/admin/src/app/api/portal/pagos/route.ts. Sin filtros: Alegra
 * ignora las fechas en pagos. El cliente sale de la identidad, nunca del query.
 */
export async function GET(request: Request) {
  const guard = await requerirCuentaCorriente();
  if (guard.error) return guard.error;

  const { start } = paramsPagos(new URL(request.url).searchParams);
  try {
    return jsonNoStore(await getPagosPage(guard.cliente.codigocliente, start, PAGOS_PAGE_SIZE));
  } catch (err) {
    if (esLimiteAlegra(err)) return jsonNoStore({ error: ALEGRA_OCUPADO }, { status: 503 });
    // Sólo el motivo técnico: nunca el cuerpo de Alegra ni datos del contacto.
    console.error(`mi-cuenta/pagos: Alegra falló (${motivoAlegra(err)})`);
    return jsonNoStore({ error: PAGOS_CAIDOS }, { status: 502 });
  }
}
