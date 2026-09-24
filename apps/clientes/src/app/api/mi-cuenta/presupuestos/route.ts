import { esLimiteAlegra } from "@/lib/cuenta-corriente/alegra-cc";
import { PRESUPUESTOS_PAGE_SIZE, getPresupuestosPage } from "@/lib/cuenta-corriente/erp-cc";
import { paramsPresupuestos } from "@/lib/cuenta-corriente/filtros";
import { jsonNoStore, requerirCliente } from "@/lib/cuenta-corriente/guard";
import { ALEGRA_OCUPADO, PRESUPUESTOS_CAIDOS, motivoAlegra } from "@/lib/cuenta-corriente/mensajes";

/**
 * Páginas de presupuestos para "Cargar más" y los filtros de Mi cuenta →
 * Presupuestos. `GET ?start&estado(aceptado|sin_aceptar)&desde&hasta` →
 * `{ presupuestos, total }`, de a 30.
 *
 * Portado de apps/admin/src/app/api/portal/presupuestos/route.ts. Los filtros
 * los resuelve Alegra. El cliente sale de la identidad, nunca del query.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requerirCliente();
  if (guard.error) return guard.error;

  const params = paramsPresupuestos(new URL(request.url).searchParams);
  if (params.error !== undefined) return jsonNoStore({ error: params.error }, { status: 400 });

  try {
    const pagina = await getPresupuestosPage(
      guard.cliente.codigocliente,
      params.start,
      PRESUPUESTOS_PAGE_SIZE,
      params.filtros,
    );
    return jsonNoStore(pagina);
  } catch (err) {
    if (esLimiteAlegra(err)) return jsonNoStore({ error: ALEGRA_OCUPADO }, { status: 503 });
    // Sólo el motivo técnico: nunca el cuerpo de Alegra ni datos del contacto.
    console.error(`mi-cuenta/presupuestos: Alegra falló (${motivoAlegra(err)})`);
    return jsonNoStore({ error: PRESUPUESTOS_CAIDOS }, { status: 502 });
  }
}
